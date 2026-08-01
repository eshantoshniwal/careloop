/**
 * Calls to the CareLoop bridge (intake, outbound dialling, approval).
 *
 * The shared secret here is a local-development convenience. Shipping it in a
 * browser bundle is not a production pattern: a real deployment should have the
 * dashboard present the clinician's own Medplum token and have the bridge
 * verify it.
 */

const BASE = import.meta.env.VITE_BRIDGE_URL || 'http://localhost:3000';
const SECRET = import.meta.env.VITE_BRIDGE_SECRET || 'dev-secret';

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CareLoop-Secret': SECRET,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(parsed.error ?? `Bridge returned ${response.status}`);
  }
  return parsed as T;
}

export interface BridgeHealth {
  ok: boolean;
  activeCalls: number;
  live: Record<string, boolean>;
}

export const getHealth = () => request<BridgeHealth>('/health');

export interface ModuleSummary {
  id: string;
  display: string;
  instrument: string;
  items: number;
  icd10?: string;
  riskQuestions?: number;
}

export const getModules = () => request<ModuleSummary[]>('/modules');

export interface IntakePayload {
  moduleId: string;
  givenName: string;
  familyName: string;
  birthDate: string;
  phone: string;
  coverage?: { payerId: string; payerName?: string; memberId: string };
  allergies?: string[];
  triggers?: string[];
}

export const createIntake = (payload: IntakePayload) =>
  request<{ patientId: string; conditionId: string; moduleId: string }>('/intake', payload);

export const startCall = (patientId: string, moduleId?: string) =>
  request<{ callId: string; callSid: string; mock: boolean }>('/call', { patientId, moduleId });

export const approve = (input: {
  carePlanId: string;
  hasCriticalFlag: boolean;
  acknowledgedCriticalFlags: boolean;
  approverReference?: string;
}) => request<{ approved: boolean; reason?: string }>('/plans/approve', input);
