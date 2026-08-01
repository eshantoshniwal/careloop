import type WebSocket from 'ws';
import { getModule } from '../conditions/registry.js';
import { DeepgramAgent } from '../integrations/deepgram.js';
import { logger } from '../logger.js';
import { runPostCallPipeline } from '../orchestration/postcall.js';
import { buildAgentPrompt, buildGreeting } from '../orchestration/prompt.js';
import {
  AGENT_FUNCTIONS,
  createCallState,
  dispatchTool,
  toCallOutcome,
  type CallState,
} from '../orchestration/tools.js';
import type { PatientContext } from '../types.js';

/**
 * One CallSession per phone call.
 *
 * Everything mutable — the Deepgram socket, the answer map, the concerns, the
 * tool-call idempotency set — lives on the instance. Nothing is shared between
 * calls, so a failure in one call cannot corrupt another. Medplum is reached
 * through a stateless client, so there is no per-call connection to leak.
 */
export class CallSession {
  readonly state: CallState;
  private agent?: DeepgramAgent;
  private twilioSocket?: WebSocket;
  private streamSid?: string;
  private ended = false;
  private postCallStarted = false;

  constructor(
    readonly callId: string,
    readonly context: PatientContext,
  ) {
    this.state = createCallState(callId, context);
  }

  attachTwilio(socket: WebSocket): void {
    this.twilioSocket = socket;

    socket.on('message', (raw) => {
      let message: any;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (message.event) {
        case 'start':
          this.streamSid = message.start?.streamSid;
          logger.info({ callId: this.callId, streamSid: this.streamSid }, 'twilio.stream.start');
          this.startAgent();
          break;
        case 'media':
          if (message.media?.payload) {
            this.agent?.sendAudio(Buffer.from(message.media.payload, 'base64'));
          }
          break;
        case 'stop':
          logger.info({ callId: this.callId }, 'twilio.stream.stop');
          void this.end('twilio-stop');
          break;
        default:
          break;
      }
    });

    socket.on('close', () => void this.end('twilio-close'));
    socket.on('error', (error) => {
      logger.warn({ callId: this.callId, err: String(error) }, 'twilio.socket.error');
      void this.end('twilio-error');
    });
  }

  private startAgent(): void {
    if (this.agent) return;
    const module = getModule(this.context.moduleId);

    const agent = new DeepgramAgent({
      prompt: buildAgentPrompt({ module, context: this.context }),
      greeting: buildGreeting(this.context),
      functions: AGENT_FUNCTIONS,
    });
    this.agent = agent;

    agent.on('audio', (chunk) => this.sendToTwilio(chunk));

    agent.on('userStartedSpeaking', () => {
      // Barge-in: drop anything Twilio has buffered so the patient is not
      // talking over a sentence the agent has already committed to.
      if (this.twilioSocket && this.streamSid) {
        this.twilioSocket.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }));
      }
    });

    agent.on('functionCall', (call) => {
      void (async () => {
        const result = await dispatchTool({
          state: this.state,
          toolCallId: call.id,
          name: call.name,
          args: call.args,
        });
        agent.respondToFunctionCall(call.id, call.name, result.say);

        // Submission is the signal that the clinical content of the call is
        // complete. The pipeline starts now so the patient never waits on it.
        if (call.name === 'submitQuestionnaire' && this.state.submitted) {
          this.startPostCall('questionnaire-submitted');
        }
      })();
    });

    agent.on('transcript', (role, text) => {
      logger.debug({ callId: this.callId, role, chars: text.length }, 'call.transcript');
    });

    agent.on('error', () => void this.end('agent-error'));
    agent.on('close', () => void this.end('agent-close'));

    agent.connect();
  }

  private sendToTwilio(chunk: Buffer): void {
    if (!this.twilioSocket || !this.streamSid) return;
    if (this.twilioSocket.readyState !== 1) return;
    this.twilioSocket.send(
      JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: { payload: chunk.toString('base64') },
      }),
    );
  }

  /**
   * Fire-and-forget. Deliberately not awaited anywhere on the call path.
   * Idempotent because both submission and hangup can trigger it.
   */
  startPostCall(reason: string): void {
    if (this.postCallStarted) return;
    if (this.state.answers.size === 0) {
      logger.warn({ callId: this.callId, reason }, 'postcall.skipped.no-answers');
      return;
    }
    this.postCallStarted = true;

    void runPostCallPipeline({
      outcome: toCallOutcome(this.state),
      questionnaireResponse: this.state.questionnaireResponse,
      context: this.context,
    })
      .then((result) => {
        logger.info(
          { callId: this.callId, reason, carePlanId: result.written.carePlanId },
          'postcall.pipeline.done',
        );
      })
      .catch((error) => {
        logger.error({ callId: this.callId, err: String(error) }, 'postcall.pipeline.failed');
      });
  }

  async end(reason: string): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    logger.info({ callId: this.callId, reason, answers: this.state.answers.size }, 'call.ended');

    this.agent?.close();
    if (this.twilioSocket && this.twilioSocket.readyState === 1) {
      this.twilioSocket.close();
    }

    // A call that hung up mid-questionnaire still produces a draft, so the
    // clinician sees a visibly partial record rather than nothing at all.
    this.startPostCall(reason);
  }
}

const sessions = new Map<string, CallSession>();

export function registerSession(session: CallSession): void {
  sessions.set(session.callId, session);
}

export function getSession(callId: string): CallSession | undefined {
  return sessions.get(callId);
}

export function removeSession(callId: string): void {
  sessions.delete(callId);
}

export function activeSessionCount(): number {
  return sessions.size;
}
