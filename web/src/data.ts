import type {
  CarePlan,
  Communication,
  MedicationRequest,
  Observation,
  Patient,
  Task,
} from '@medplum/fhirtypes';
import { medplum } from './medplum';

/**
 * Read models for the review workflow.
 *
 * The dashboard reads only what the signed-in clinician's workflow needs.
 * Production authorisation must additionally enforce patient/tenant scope and
 * audit every read — Medplum access policies are the right place for that, not
 * this file.
 */

export const CATEGORIES = {
  research: 'careloop-research',
  panel: 'careloop-panel',
  safety: 'careloop-safety',
  coverage: 'careloop-coverage',
  recap: 'careloop-recap',
  chart: 'careloop-chart',
  concern: 'careloop-concern',
  education: 'careloop-education',
} as const;

export async function fetchDraftPlans(): Promise<CarePlan[]> {
  const plans = await medplum.searchResources('CarePlan', {
    status: 'draft',
    _sort: '-_lastUpdated',
    _count: '50',
  });
  return [...plans];
}

export async function fetchPatient(reference: string | undefined): Promise<Patient | undefined> {
  const id = reference?.split('/')[1];
  if (!id) return undefined;
  try {
    return await medplum.readResource('Patient', id);
  } catch {
    return undefined;
  }
}

export async function fetchMedications(plan: CarePlan): Promise<MedicationRequest[]> {
  const ids = (plan.activity ?? [])
    .map((activity) => activity.reference?.reference)
    .filter((ref): ref is string => Boolean(ref?.startsWith('MedicationRequest/')))
    .map((ref) => ref.split('/')[1])
    .filter((id): id is string => Boolean(id));

  const results = await Promise.all(
    ids.map((id) =>
      medplum.readResource('MedicationRequest', id).catch(() => undefined),
    ),
  );
  return results.filter((r): r is MedicationRequest => Boolean(r));
}

export async function fetchCommunications(patientId: string): Promise<Communication[]> {
  const results = await medplum.searchResources('Communication', {
    subject: `Patient/${patientId}`,
    _sort: '-sent',
    _count: '100',
  });
  return [...results];
}

export async function fetchScoreHistory(patientId: string): Promise<Observation[]> {
  const results = await medplum.searchResources('Observation', {
    subject: `Patient/${patientId}`,
    status: 'final',
    _sort: 'date',
    _count: '50',
  });
  // Total-score Observations carry a {score} unit; item-level ones do not.
  return [...results].filter((obs) => obs.valueQuantity?.unit === '{score}');
}

export async function fetchReviewTask(carePlanId: string): Promise<Task | undefined> {
  const results = await medplum.searchResources('Task', { focus: `CarePlan/${carePlanId}` });
  return results[0];
}

export function communicationText(communication: Communication): string {
  return (communication.payload ?? [])
    .map((entry) => entry.contentString ?? '')
    .filter(Boolean)
    .join('\n');
}

export function byCategory(
  communications: Communication[],
  category: string,
): Communication[] {
  return communications.filter((c) => c.category?.some((cat) => cat.text === category));
}

/** A draft is gated on approval when its safety artifact contains a critical line. */
export function hasCriticalFlag(communications: Communication[]): boolean {
  return byCategory(communications, CATEGORIES.safety).some((c) =>
    communicationText(c).toLowerCase().includes('[critical]'),
  );
}

export async function saveMedication(request: MedicationRequest): Promise<MedicationRequest> {
  return medplum.updateResource(request);
}
