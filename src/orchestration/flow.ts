import type { ConditionModule } from '../conditions/types.js';
import type { PatientContext } from '../types.js';

/**
 * The call as data.
 *
 * Both orchestration modes render from this one spec, which is the point: the
 * flow is described once, so `prompt` mode and `state` mode cannot drift into
 * asking different questions. Changing the interview means changing the flow,
 * never one renderer.
 */

export type NodeKind =
  | 'greeting'
  | 'verify'
  | 'instrument-item'
  | 'risk-question'
  | 'open-concerns'
  | 'recap'
  | 'close';

export interface FlowNode {
  id: string;
  kind: NodeKind;
  /** Spoken instruction for this turn. May contain {{placeholders}}. */
  say: string;
  /** Tools the agent may call while on this node. */
  tools: string[];
  /** Next node id, or undefined for a terminal node. */
  next?: string;
  /** Node to visit for an off-script question, returning here afterwards. */
  detour?: string;
  meta?: Record<string, string | number>;
}

export interface Flow {
  moduleId: string;
  start: string;
  nodes: FlowNode[];
  /** Rules that outrank the flow entirely. */
  emergencyRules: string[];
}

const QA_TOOLS = ['getCareContext', 'checkCoverage', 'recordConcern'];

/**
 * Build the interview flow for a module.
 *
 * The Q&A tools are attached to every node rather than to a dedicated node
 * because patients ask questions whenever they want, not when the script
 * allows. A flow that only permits questions at the end would force the agent
 * to either ignore them or leave the flow.
 */
export function buildIntakeFlow(module: ConditionModule): Flow {
  const nodes: FlowNode[] = [];

  const itemIds = module.instrument.items.map((item) => `item:${item.linkId}`);
  const riskIds = module.riskQuestions.map((question) => `risk:${question.linkId}`);
  const afterItems = riskIds[0] ?? 'concerns';
  const afterRisks = 'concerns';

  nodes.push({
    id: 'greeting',
    kind: 'greeting',
    say: "Introduce yourself as Maya calling from the clinic about {{firstName}}'s upcoming appointment for their {{conditionLower}}. Ask if now is a good time. If it is not, offer to call back and end the call.",
    tools: [],
    next: 'verify',
  });

  nodes.push({
    id: 'verify',
    kind: 'verify',
    say: 'Ask the patient to confirm their date of birth. Do not read it out to them — ask them for it. Accept spoken formats such as "March fourteenth eighty-five". If it does not match, do not continue with clinical questions: say the clinic will call back, and end warmly.',
    tools: [],
    next: itemIds[0] ?? 'concerns',
  });

  for (const [index, item] of module.instrument.items.entries()) {
    nodes.push({
      id: `item:${item.linkId}`,
      kind: 'instrument-item',
      say: `Ask exactly: "${item.prompt}" The scale is ${item.min} to ${item.max}; ${item.scaleHint}. After they answer, call chartLive with linkId "${item.linkId}" and the number. If they describe rather than score, map it to the closest number and read back what you recorded.`,
      tools: ['chartLive', ...QA_TOOLS],
      next: itemIds[index + 1] ?? afterItems,
      meta: { linkId: item.linkId, min: item.min, max: item.max },
    });
  }

  for (const [index, question] of module.riskQuestions.entries()) {
    nodes.push({
      id: `risk:${question.linkId}`,
      kind: 'risk-question',
      say: `Ask gently: "${question.prompt}" Record the answer with chartRiskAnswer using linkId "${question.linkId}". If the patient declines, accept that and move on.`,
      tools: ['chartRiskAnswer', ...QA_TOOLS],
      next: riskIds[index + 1] ?? afterRisks,
      meta: { linkId: question.linkId, expects: question.expects },
    });
  }

  nodes.push({
    id: 'concerns',
    kind: 'open-concerns',
    say: 'Ask what else has been on their mind about their {{conditionLower}}. Record each distinct thing with recordConcern. Answer clinical questions with getCareContext and cost or coverage questions with checkCoverage.',
    tools: QA_TOOLS,
    next: 'recap',
  });

  nodes.push({
    id: 'recap',
    kind: 'recap',
    say: 'Reflect back the one or two most important things they told you, in your own words, so they know they were heard. Offer one grounded, non-prescriptive tip from getCareContext if it fits. Say a clinician will review everything and be in touch. Do not state a score, a band, a medication, or a plan.',
    tools: QA_TOOLS,
    next: 'close',
  });

  nodes.push({
    id: 'close',
    kind: 'close',
    say: 'Call submitQuestionnaire exactly once, then thank them warmly and say goodbye.',
    tools: ['submitQuestionnaire'],
  });

  return { moduleId: module.id, start: 'greeting', nodes, emergencyRules: module.emergencyRules };
}

// ------------------------------------------------------------ interpolation

/** Replaces {{key}} with the supplied value; unknown keys are left visible. */
export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => values[key] ?? whole);
}

export function flowValues(context: PatientContext, module: ConditionModule): Record<string, string> {
  return {
    firstName: context.fullName.split(' ')[0] ?? 'there',
    fullName: context.fullName,
    conditionDisplay: context.conditionDisplay ?? module.display,
    conditionLower: (context.conditionDisplay ?? module.display).toLowerCase(),
    birthDate: context.birthDate ?? 'unknown',
  };
}

export function nodeById(flow: Flow, id: string): FlowNode | undefined {
  return flow.nodes.find((node) => node.id === id);
}

/** Every tool any node may use — the union the live agent is given. */
export function allFlowTools(flow: Flow): string[] {
  return [...new Set(flow.nodes.flatMap((node) => node.tools))];
}
