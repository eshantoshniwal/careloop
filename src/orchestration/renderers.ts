import type { ConditionModule } from '../conditions/types.js';
import type { PatientContext } from '../types.js';
import { allFlowTools, buildIntakeFlow, flowValues, interpolate, nodeById, type Flow } from './flow.js';

/**
 * Two renderings of the same flow.
 *
 * `prompt` mode flattens the whole flow into one system prompt and gives the
 * agent every tool at once. It is the live default because voice-agent
 * providers generally cannot change a tool set mid-call.
 *
 * `state` mode walks the flow node by node, exposing only the tools that node
 * allows. It is stricter and easier to reason about, but it needs a provider
 * that supports mid-call reconfiguration. Keeping both renderers honest
 * against one spec is what makes the comparison meaningful in the simulator.
 */

export type OrchestrationMode = 'prompt' | 'state';

function historyLine(context: PatientContext): string {
  if (context.priorScores.length === 0) {
    return 'This is the first recorded check-in for this patient. Do not imply you have spoken before.';
  }
  const recent = context.priorScores.slice(-3);
  const last = recent[recent.length - 1];
  return (
    `Previous totals, oldest to newest: ${recent.map((s) => `${s.total} (${s.date.slice(0, 10)})`).join(', ')}. ` +
    `Last time the score was ${last?.total} — "${last?.band}". You may refer to this naturally. ` +
    'Do not ask the patient to repeat anything already listed here.'
  );
}

function preamble(module: ConditionModule, context: PatientContext, flow: Flow): string {
  return `You are Maya, a warm, unhurried check-in assistant calling on behalf of a clinic before a patient's appointment. You are on the phone: keep every turn to one or two sentences and never read out lists.

# ABSOLUTE RULES — these override everything below
${flow.emergencyRules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}
${flow.emergencyRules.length + 1}. You are NOT a prescriber and NOT a diagnostician. Never say what medication the patient will get, never give a dose, and never state or confirm a diagnosis. Say a clinician reviews everything and decides.
${flow.emergencyRules.length + 2}. Never invent clinical facts. Use getCareContext, or say a clinician will answer it.
${flow.emergencyRules.length + 3}. If the patient wants to stop, stop immediately and warmly.

# WHO YOU ARE CALLING
Name: ${context.fullName}
Condition on file: ${context.conditionDisplay ?? module.display}
${context.birthDate ? `Date of birth on file: ${context.birthDate}` : 'No date of birth on file.'}
Current medications: ${context.currentMedications.map((m) => m.display).join('; ') || 'none recorded'}
Recorded allergies: ${context.allergies.join('; ') || 'none recorded'}
Known triggers: ${context.triggers.join('; ') || 'none recorded'}
History: ${historyLine(context)}`;
}

const STYLE = `# STYLE
Speak like a person, not a form. Contractions are good. Vary how you acknowledge answers and don't say "thank you" after every single one — sometimes just move straight to the next question, sometimes reflect a word back ("okay, sounds pretty settled then"). Never recite the rating scale twice for the same question or announce "the same scale" between questions. Never say "linkId", "tool", "system", "score" or "band" out loud. If there is silence, wait — do not fill it immediately.`;

/** Whole flow as one prompt. */
export function renderPromptMode(module: ConditionModule, context: PatientContext): string {
  const flow = buildIntakeFlow(module);
  const values = flowValues(context, module);

  const steps = flow.nodes
    .map((node, index) => {
      const tools = node.tools.length ? `  [tools: ${node.tools.join(', ')}]` : '';
      return `${index + 1}. (${node.kind}) ${interpolate(node.say, values)}${tools}`;
    })
    .join('\n');

  return `${preamble(module, context, flow)}

# CALL FLOW — follow in order
${steps}

${STYLE}`;
}

export interface StateModeView {
  nodeId: string;
  prompt: string;
  tools: string[];
  next?: string;
}

/** One node's prompt plus the tools gated to it. */
export function renderStateNode(
  module: ConditionModule,
  context: PatientContext,
  nodeId: string,
): StateModeView | undefined {
  const flow = buildIntakeFlow(module);
  const node = nodeById(flow, nodeId);
  if (!node) return undefined;
  const values = flowValues(context, module);

  return {
    nodeId: node.id,
    prompt: `${preamble(module, context, flow)}

# CURRENT STEP (${node.kind})
${interpolate(node.say, values)}

When this step is done, stop and wait. Do not continue to the next question on your own.

${STYLE}`,
    tools: node.tools,
    next: node.next,
  };
}

/** Metrics used to compare the two renderings deterministically. */
export function compareRenderings(
  module: ConditionModule,
  context: PatientContext,
): {
  promptChars: number;
  promptTools: number;
  stateStartNode: string;
  stateNodes: number;
  stateStartTools: number;
  maxNodeTools: number;
} {
  const flow = buildIntakeFlow(module);
  const prompt = renderPromptMode(module, context);
  const start = renderStateNode(module, context, flow.start);

  return {
    promptChars: prompt.length,
    promptTools: allFlowTools(flow).length,
    stateStartNode: flow.start,
    stateNodes: flow.nodes.length,
    stateStartTools: start?.tools.length ?? 0,
    maxNodeTools: Math.max(...flow.nodes.map((node) => node.tools.length)),
  };
}
