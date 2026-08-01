import { env } from '../config/env.js';
import type { ConditionModule } from '../conditions/types.js';
import { logger } from '../logger.js';
import type { PatientContext } from '../types.js';
import { buildIntakeFlow } from './flow.js';
import { renderPromptMode, renderStateNode } from './renderers.js';

/**
 * The live agent prompt.
 *
 * Both orchestration modes render from the single flow spec in `flow.ts`, so
 * the interview cannot drift between them. `prompt` is the live default; see
 * the note on `env.orchMode`.
 */
export function buildAgentPrompt(input: {
  module: ConditionModule;
  context: PatientContext;
}): string {
  const { module, context } = input;

  if (env.orchMode === 'state') {
    const flow = buildIntakeFlow(module);
    const start = renderStateNode(module, context, flow.start);
    if (start) {
      logger.info({ mode: 'state', node: start.nodeId }, 'prompt.rendered');
      return start.prompt;
    }
    logger.warn('prompt.state.start-missing — falling back to prompt mode');
  }

  const prompt = renderPromptMode(module, context);
  logger.info({ mode: 'prompt', chars: prompt.length }, 'prompt.rendered');
  return prompt;
}

export function buildGreeting(context: PatientContext): string {
  const firstName = context.fullName.split(' ')[0] ?? 'there';
  // Beat one only: confirm we have the right person before saying anything
  // else. The purpose introduction and the "is now a good time?" check follow
  // in the greeting flow node once identity is confirmed.
  return `Hi there — is this ${firstName}?`;
}
