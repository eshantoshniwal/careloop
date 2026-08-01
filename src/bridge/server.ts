import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { env, live, publicBaseUrl } from '../config/env.js';
import { listModules } from '../conditions/registry.js';
import { buildStreamTwiml } from '../integrations/twilio.js';
import { placeOutboundCall } from '../integrations/twilio.js';
import { logger } from '../logger.js';
import { loadPatientContext } from '../orchestration/context.js';
import { createIntake } from '../orchestration/intake.js';
import { approvePlan } from '../orchestration/plan.js';
import { CallSession, activeSessionCount, getSession, registerSession, removeSession } from './session.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// The dashboard runs on a different origin and authenticates to Medplum
// directly; it only needs these bridge endpoints.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CareLoop-Secret');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

/** Shared-secret gate for anything that writes or dials out. */
function requireSecret(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const provided = req.header('X-CareLoop-Secret');
  if (provided !== env.toolSharedSecret) {
    res.status(401).json({ error: 'unauthorised' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Health and metadata
// ---------------------------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    activeCalls: activeSessionCount(),
    publicBaseUrl: publicBaseUrl(),
    // Explicitly surfaced so it is always obvious which results are real.
    live,
  });
});

app.get('/modules', (_req, res) => {
  res.json(
    listModules().map((module) => ({
      id: module.id,
      display: module.display,
      icd10: module.icd10,
      instrument: module.instrument.name,
      items: module.instrument.items.length,
      riskQuestions: module.riskQuestions.length,
    })),
  );
});

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

const intakeSchema = z.object({
  moduleId: z.string().min(1),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phone: z.string().min(5),
  coverage: z
    .object({
      payerId: z.string(),
      payerName: z.string().optional(),
      memberId: z.string(),
      subscriberFirstName: z.string().optional(),
      subscriberLastName: z.string().optional(),
      subscriberDob: z.string().optional(),
    })
    .optional(),
  allergies: z.array(z.string()).optional(),
  triggers: z.array(z.string()).optional(),
});

app.post('/intake', requireSecret, async (req, res) => {
  const parsed = intakeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid intake', issues: parsed.error.issues });
    return;
  }
  try {
    const result = await createIntake(parsed.data);
    res.status(201).json(result);
  } catch (error) {
    logger.error({ err: String(error) }, 'intake.failed');
    res.status(500).json({ error: 'intake failed' });
  }
});

// ---------------------------------------------------------------------------
// Outbound call
// ---------------------------------------------------------------------------

const callSchema = z.object({
  patientId: z.string().min(1),
  moduleId: z.string().optional(),
  /** Overrides the phone on the Patient resource. */
  phone: z.string().optional(),
});

app.post('/call', requireSecret, async (req, res) => {
  const parsed = callSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid call request', issues: parsed.error.issues });
    return;
  }

  try {
    const context = await loadPatientContext({
      patientId: parsed.data.patientId,
      moduleId: parsed.data.moduleId,
    });
    const to = parsed.data.phone ?? context.phone;
    if (!to) {
      res.status(400).json({ error: 'no phone number on file for this patient' });
      return;
    }

    const callId = randomUUID();
    registerSession(new CallSession(callId, context));

    const call = await placeOutboundCall(to, callId);
    logger.info({ callId, callSid: call.callSid, mock: call.mock }, 'call.started');
    res.status(202).json({ callId, callSid: call.callSid, mock: call.mock });
  } catch (error) {
    logger.error({ err: String(error) }, 'call.failed');
    res.status(500).json({ error: 'could not start call' });
  }
});

// ---------------------------------------------------------------------------
// Twilio webhooks
// ---------------------------------------------------------------------------

app.post('/voice', (req, res) => {
  const callId = String(req.query.callId ?? '');
  if (!callId || !getSession(callId)) {
    logger.warn({ callId }, 'voice.unknown-call');
    res.type('text/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this call could not be set up. Goodbye.</Say><Hangup/></Response>`,
    );
    return;
  }
  res.type('text/xml').send(buildStreamTwiml(callId));
});

app.post('/voice/status', (req, res) => {
  const callId = String(req.query.callId ?? '');
  const status = String(req.body?.CallStatus ?? '');
  logger.info({ callId, status }, 'twilio.call.status');
  if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status)) {
    const session = getSession(callId);
    void session?.end(`twilio-${status}`);
    // Keep the session briefly so a late post-call write can still resolve it.
    setTimeout(() => removeSession(callId), 60_000).unref();
  }
  res.sendStatus(204);
});

// ---------------------------------------------------------------------------
// Clinician approval
// ---------------------------------------------------------------------------

const approveSchema = z.object({
  carePlanId: z.string().min(1),
  approverReference: z.string().optional(),
  hasCriticalFlag: z.boolean().default(false),
  acknowledgedCriticalFlags: z.boolean().default(false),
});

app.post('/plans/approve', requireSecret, async (req, res) => {
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid approval', issues: parsed.error.issues });
    return;
  }
  const result = await approvePlan(parsed.data);
  res.status(result.approved ? 200 : 409).json(result);
});

// ---------------------------------------------------------------------------
// WebSocket: Twilio bidirectional media stream
// ---------------------------------------------------------------------------

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
  if (url.pathname !== '/twilio') {
    socket.destroy();
    return;
  }
  const callId = url.searchParams.get('callId') ?? '';
  const session = getSession(callId);
  if (!session) {
    logger.warn({ callId }, 'ws.unknown-call');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    session.attachTwilio(ws);
  });
});

server.listen(env.port, () => {
  logger.info(
    { port: env.port, publicBaseUrl: publicBaseUrl(), live },
    'careloop.bridge.listening',
  );
  for (const [name, enabled] of Object.entries(live)) {
    if (!enabled) logger.warn(`${name} is in MOCK mode — results are not real`);
  }
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'careloop.bridge.shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app, server };
