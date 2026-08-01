import { env, live } from '../config/env.js';
import { logger } from '../logger.js';
import type { MossCorpusEntry } from '../conditions/types.js';
import type { RetrievalSnippet } from '../types.js';

/**
 * Moss is the retrieval layer for patient-*safe* condition knowledge only.
 *
 * It must never receive patient identifiers, transcripts, coverage details or
 * clinical history. Those live in Medplum and are passed directly to the
 * orchestration layer instead. The only thing sent to Moss is the question
 * text and the static condition corpus.
 */

export interface MossClient {
  retrieve(question: string, options?: { k?: number }): Promise<RetrievalSnippet[]>;
}

interface MossIndexConfig {
  indexName: string;
  corpus: MossCorpusEntry[];
}

const clients = new Map<string, MossClient>();

// ---------------------------------------------------------------------------
// Deterministic keyword scorer (mock mode)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'my', 'i', 'do',
  'does', 'what', 'how', 'why', 'when', 'should', 'can', 'for', 'on', 'with',
  'are', 'be', 'about', 'me', 'you', 'this', 'that', 'if',
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function keywordScore(question: string, entry: MossCorpusEntry): number {
  const questionTokens = tokenise(question);
  if (questionTokens.length === 0) return 0;
  const entryTokens = new Set(tokenise(`${entry.id} ${entry.text}`));
  let hits = 0;
  for (const token of questionTokens) {
    if (entryTokens.has(token)) hits += 1;
  }
  return hits / questionTokens.length;
}

function mockClient(config: MossIndexConfig): MossClient {
  return {
    async retrieve(question, options) {
      const k = options?.k ?? 1;
      const ranked = config.corpus
        .map((entry) => ({ entry, score: keywordScore(question, entry) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);

      // A zero-scoring corpus still returns its first entry rather than
      // nothing, so the agent always has something safe to say.
      const selected = ranked.some((r) => r.score > 0) ? ranked : ranked.slice(0, 1);

      return selected.map(({ entry, score }) => ({
        text: entry.text,
        source: entry.source,
        score,
        mock: true,
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// Live client (@moss-dev/moss, lazily imported)
// ---------------------------------------------------------------------------

/**
 * The Moss SDK ships a native binding. Importing it eagerly would make the
 * whole bridge fail to boot on a platform where the binding cannot load, so
 * the import happens on first use and any failure degrades to mock retrieval.
 */
async function loadMossSdk(): Promise<any | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<any>;
    return await dynamicImport('@moss-dev/moss');
  } catch (error) {
    logger.warn({ err: String(error) }, 'moss.sdk.unavailable');
    return undefined;
  }
}

function liveClient(config: MossIndexConfig): MossClient {
  let ready: Promise<any | undefined> | undefined;
  const fallback = mockClient(config);

  async function ensureIndex(): Promise<any | undefined> {
    if (!ready) {
      ready = (async () => {
        const sdk = await loadMossSdk();
        if (!sdk) return undefined;
        const Moss = sdk.Moss ?? sdk.default;
        const client = new Moss({
          projectId: env.moss.projectId,
          projectKey: env.moss.projectKey,
        });
        // Load the index once per client. Creating it is idempotent server-side.
        await client.loadIndex?.(config.indexName);
        logger.info({ index: config.indexName }, 'moss.index.loaded');
        return client;
      })().catch((error) => {
        logger.warn({ index: config.indexName, err: String(error) }, 'moss.index.load.failed');
        return undefined;
      });
    }
    return ready;
  }

  return {
    async retrieve(question, options) {
      const k = options?.k ?? 1;
      const client = await ensureIndex();
      if (!client) return fallback.retrieve(question, options);
      try {
        const response = await client.query(config.indexName, question, { topK: k });
        const rows: any[] = response?.results ?? response?.matches ?? response ?? [];
        if (!Array.isArray(rows) || rows.length === 0) {
          logger.warn({ index: config.indexName }, 'moss.live.empty');
          return fallback.retrieve(question, options);
        }
        return rows.slice(0, k).map((row) => ({
          text: String(row.text ?? row.content ?? row.document ?? ''),
          source: String(row.source ?? row.metadata?.source ?? config.indexName),
          score: Number(row.score ?? row.similarity ?? 0),
          mock: false,
        }));
      } catch (error) {
        logger.warn({ index: config.indexName, err: String(error) }, 'moss.live.fallback');
        return fallback.retrieve(question, options);
      }
    },
  };
}

export function getMossClient(config: MossIndexConfig): MossClient {
  const cached = clients.get(config.indexName);
  if (cached) return cached;
  const client = live.moss ? liveClient(config) : mockClient(config);
  if (!live.moss) {
    logger.debug({ index: config.indexName }, 'moss.mock.enabled');
  }
  clients.set(config.indexName, client);
  return client;
}

/** Used by `npm run moss:index` to push a condition corpus. */
export async function indexCorpus(config: MossIndexConfig): Promise<'live' | 'skipped'> {
  if (!live.moss) {
    logger.warn({ index: config.indexName }, 'moss.index.skipped.no-credentials');
    return 'skipped';
  }
  const sdk = await loadMossSdk();
  if (!sdk) return 'skipped';
  const Moss = sdk.Moss ?? sdk.default;
  const client = new Moss({ projectId: env.moss.projectId, projectKey: env.moss.projectKey });
  await client.createIndex?.(config.indexName);
  for (const entry of config.corpus) {
    await client.upsert?.(config.indexName, {
      id: entry.id,
      text: entry.text,
      metadata: { source: entry.source },
    });
  }
  await client.saveIndex?.(config.indexName);
  logger.info({ index: config.indexName, documents: config.corpus.length }, 'moss.index.written');
  return 'live';
}
