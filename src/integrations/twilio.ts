import twilio from 'twilio';
import { env, live, publicBaseUrl, publicWsUrl } from '../config/env.js';
import { logger } from '../logger.js';

let client: ReturnType<typeof twilio> | undefined;

function getClient(): ReturnType<typeof twilio> {
  if (!client) {
    client = twilio(env.twilio.accountSid, env.twilio.authToken);
  }
  return client;
}

export interface PlacedCall {
  callSid: string;
  mock: boolean;
}

export async function placeOutboundCall(to: string, callId: string): Promise<PlacedCall> {
  if (!live.twilio) {
    logger.warn({ callId }, 'twilio.mock.call');
    return { callSid: `mock-call-${callId}`, mock: true };
  }
  const call = await getClient().calls.create({
    to,
    from: env.twilio.phoneNumber,
    url: `${publicBaseUrl()}/voice?callId=${encodeURIComponent(callId)}`,
    statusCallback: `${publicBaseUrl()}/voice/status?callId=${encodeURIComponent(callId)}`,
    statusCallbackEvent: ['initiated', 'answered', 'completed'],
    machineDetection: 'Enable',
  });
  logger.info({ callId, callSid: call.sid }, 'twilio.call.placed');
  return { callSid: call.sid, mock: false };
}

/**
 * TwiML that hands the media stream straight to the bridge. `<Connect><Stream>`
 * is bidirectional, which is what lets the agent both hear and speak.
 */
export function buildStreamTwiml(callId: string): string {
  const streamUrl = `${publicWsUrl('/twilio')}?callId=${encodeURIComponent(callId)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}">
      <Parameter name="callId" value="${callId}" />
    </Stream>
  </Connect>
</Response>`;
}

export function buildHangupTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${message}</Say>
  <Hangup/>
</Response>`;
}

export function validateTwilioSignature(
  signature: string | undefined,
  url: string,
  params: Record<string, unknown>,
): boolean {
  if (!live.twilio) return true;
  if (!signature) return false;
  return twilio.validateRequest(env.twilio.authToken, signature, url, params as never);
}
