import 'dotenv/config';

function str(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value.trim();
}

function num(name: string, fallback: number): number {
  const parsed = Number(str(name));
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : fallback;
}

export const env = {
  port: num('PORT', 3000),
  publicHost: str('PUBLIC_HOST'),
  logLevel: str('LOG_LEVEL', 'info'),
  toolSharedSecret: str('TOOL_SHARED_SECRET', 'dev-secret'),

  medplum: {
    baseUrl: str('MEDPLUM_BASE_URL', 'https://api.medplum.com/'),
    clientId: str('MEDPLUM_CLIENT_ID'),
    clientSecret: str('MEDPLUM_CLIENT_SECRET'),
  },

  twilio: {
    accountSid: str('TWILIO_ACCOUNT_SID'),
    authToken: str('TWILIO_AUTH_TOKEN'),
    phoneNumber: str('TWILIO_PHONE_NUMBER'),
  },

  deepgram: {
    apiKey: str('DEEPGRAM_API_KEY'),
    agentUrl: str('DEEPGRAM_AGENT_URL', 'wss://agent.deepgram.com/v1/agent/converse'),
  },

  llm: {
    provider: str('LLM_PROVIDER', 'none') as 'groq' | 'anthropic' | 'none',
    groqApiKey: str('GROQ_API_KEY'),
    groqModel: str('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    anthropicApiKey: str('ANTHROPIC_API_KEY'),
    anthropicModel: str('ANTHROPIC_MODEL', 'claude-opus-4-5'),
  },

  moss: {
    projectId: str('MOSS_PROJECT_ID'),
    projectKey: str('MOSS_PROJECT_KEY'),
  },

  stedi: {
    apiKey: str('STEDI_API_KEY'),
    baseUrl: str('STEDI_BASE_URL', 'https://healthcare.us.stedi.com'),
    payerId: str('STEDI_PAYER_ID'),
    providerNpi: str('STEDI_PROVIDER_NPI'),
    providerName: str('STEDI_PROVIDER_NAME'),
    serviceType: str('STEDI_SERVICE_TYPE', '30'),
  },

  seed: {
    patientId: str('SEED_PATIENT_ID'),
    conditionId: str('SEED_CONDITION_ID'),
    questionnaireId: str('SEED_QUESTIONNAIRE_ID'),
  },
} as const;

/**
 * Every integration has a live path and a labelled mock path. These flags are
 * the single place that decides which one runs, so telemetry can always say
 * whether a result came from a real external system.
 */
export const live = {
  medplum: Boolean(env.medplum.clientId && env.medplum.clientSecret),
  twilio: Boolean(env.twilio.accountSid && env.twilio.authToken && env.twilio.phoneNumber),
  deepgram: Boolean(env.deepgram.apiKey),
  moss: Boolean(env.moss.projectId && env.moss.projectKey),
  stedi: Boolean(env.stedi.apiKey && env.stedi.payerId && env.stedi.providerNpi),
  llm:
    (env.llm.provider === 'groq' && Boolean(env.llm.groqApiKey)) ||
    (env.llm.provider === 'anthropic' && Boolean(env.llm.anthropicApiKey)),
} as const;

export function publicBaseUrl(): string {
  return env.publicHost ? `https://${env.publicHost}` : `http://localhost:${env.port}`;
}

export function publicWsUrl(path: string): string {
  return env.publicHost
    ? `wss://${env.publicHost}${path}`
    : `ws://localhost:${env.port}${path}`;
}
