import type { ConditionModule } from '../conditions/types.js';
import type { PatientContext } from '../types.js';
import { buildIntakeFlow, nodeById, type Flow, type FlowNode, type NodeKind } from './flow.js';
import { renderStateNode, type StateModeView } from './renderers.js';

/**
 * ORCH_MODE=state: walk the flow node by node.
 *
 * The bridge — not the model — decides when the interview moves forward. Two
 * kinds of signal advance the walk:
 *
 * 1. Tool results. These are authoritative: a charted answer moves past that
 *    item, a verified DOB moves past verification. The Q&A tools
 *    (getCareContext, checkCoverage, recordConcern) never advance — a patient
 *    question is a detour, not progress.
 * 2. User turns, only on conversational nodes that have no charting tool
 *    (greeting, open-concerns, recap). This is a heuristic: the thresholds
 *    below match the number of exchanges the node's script expects.
 *
 * Deepgram cannot change the function list mid-call, so state mode still
 * declares every tool at Settings time; what changes per node is the prompt,
 * sent via UpdatePrompt. Gating is therefore instruction-level, same as prompt
 * mode — the win of state mode is that the *current step* is always explicit,
 * so the model cannot skip or reorder questions.
 */

/** Conversational nodes advance after this many patient turns. */
const USER_TURNS_TO_ADVANCE: Partial<Record<NodeKind, number>> = {
  // The hardcoded opener already covers identity, who is calling and why, so
  // the first patient reply ("yes / sure") is the confirmation → move to
  // verification immediately.
  greeting: 1,
  // Turn 1: the concern itself (charted via recordConcern, which does not
  // advance). Turn 2: "no, nothing else" → move to recap.
  'open-concerns': 2,
  // One acknowledgement of the recap → move to close.
  recap: 1,
};

export class FlowStateMachine {
  private readonly flow: Flow;
  private currentId: string;
  private userTurnsOnNode = 0;

  constructor(
    private readonly module: ConditionModule,
    private readonly context: PatientContext,
  ) {
    this.flow = buildIntakeFlow(module);
    this.currentId = this.flow.start;
  }

  get currentNodeId(): string {
    return this.currentId;
  }

  get currentNode(): FlowNode | undefined {
    return nodeById(this.flow, this.currentId);
  }

  view(): StateModeView | undefined {
    return renderStateNode(this.module, this.context, this.currentId);
  }

  /**
   * Feed a dispatched tool result. Returns the next node's view when the flow
   * advanced, undefined when it stays put (failed chart, retry, Q&A tool).
   */
  onToolResult(name: string, detail?: Record<string, unknown>): StateModeView | undefined {
    switch (name) {
      case 'verifyIdentity': {
        if (detail?.verified !== true) return undefined;
        const kind = this.currentNode?.kind;
        // A quick patient can state their DOB while the walk is still on the
        // greeting node (the tool call can beat the user-turn transcript);
        // a verified identity moves past verification from either node.
        if (kind !== 'verify' && kind !== 'greeting') return undefined;
        if (kind === 'greeting') this.currentId = 'verify';
        return this.advance();
      }
      case 'chartLive':
        return this.advancePast('item', detail);
      case 'chartRiskAnswer':
        return this.advancePast('risk', detail);
      default:
        // Q&A tools and submitQuestionnaire never move the flow; submission
        // ends the call via the session's hangup timer instead.
        return undefined;
    }
  }

  /** Feed one patient turn. Advances only conversational nodes. */
  onUserTurn(): StateModeView | undefined {
    const node = this.currentNode;
    const threshold = node ? USER_TURNS_TO_ADVANCE[node.kind] : undefined;
    if (!threshold) return undefined;
    this.userTurnsOnNode += 1;
    return this.userTurnsOnNode >= threshold ? this.advance() : undefined;
  }

  /**
   * A successful chart names the item it recorded. Re-sync to that item before
   * stepping, so a model that answered out of order pulls the walk back onto
   * the spec instead of drifting one node ahead of reality.
   */
  private advancePast(prefix: 'item' | 'risk', detail?: Record<string, unknown>): StateModeView | undefined {
    if (!detail?.linkId) return undefined; // rejected chart — stay on the node
    const before = this.currentId;
    const charted = nodeById(this.flow, `${prefix}:${String(detail.linkId)}`);
    if (charted) this.currentId = charted.id;
    const view = this.advance();
    // A re-chart of an item already behind us lands where we already are.
    // Re-sending the same prompt just burns Deepgram's prompt budget.
    return this.currentId === before ? undefined : view;
  }

  private advance(): StateModeView | undefined {
    const node = this.currentNode;
    if (!node?.next) return undefined; // terminal
    this.currentId = node.next;
    this.userTurnsOnNode = 0;
    return this.view();
  }
}
