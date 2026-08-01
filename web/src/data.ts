import type {
  CarePlan,
  Communication,
  MedicationRequest,
  Observation,
  Patient,
  Task,
} from '@medplum/fhirtypes';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { medplum } from './medplum';

/**
 * Read models for the clinician workflow.
 *
 * The dashboard reads only what the signed-in clinician needs. Production
 * authorisation must additionally enforce patient/tenant scope and audit every
 * read — Medplum access policies are the right place for that, not this file.
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
  call: 'careloop-call',
} as const;

export type Priority = 'critical' | 'urgent' | 'routine';

export function communicationText(communication: Communication): string {
  return (communication.payload ?? [])
    .map((entry) => entry.contentString ?? '')
    .filter(Boolean)
    .join('\n');
}

export function byCategory(communications: Communication[], category: string): Communication[] {
  return communications.filter((c) => c.category?.some((cat) => cat.text === category));
}

export function displayName(patient: Patient | undefined): string {
  const name = patient?.name?.[0];
  if (!name) return 'Unknown patient';
  return (
    [name.given?.join(' '), name.family].filter(Boolean).join(' ') || name.text || 'Unknown patient'
  );
}

export function idFromReference(reference: string | undefined): string | undefined {
  return reference?.split('/')[1];
}

/** Severity of a plan, derived from its safety artifact and Task priority. */
export function priorityOf(input: {
  safetyText: string;
  taskPriority?: string;
}): Priority {
  const lower = input.safetyText.toLowerCase();
  if (lower.includes('[critical]')) return 'critical';
  if (input.taskPriority === 'urgent') return 'urgent';
  if (lower.includes('[warning]')) return 'urgent';
  return 'routine';
}

// ---------------------------------------------------------------- hooks

export function useDraftPlans(pollMs = 15000): {
  plans: CarePlan[];
  loading: boolean;
  error?: string;
  refresh: () => void;
} {
  const [plans, setPlans] = useState<CarePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let first = true;
    // First load shows the skeleton; background polls swap the data in quietly,
    // so a plan appearing after a call never requires a manual reload and the
    // page never flashes a loading state at a clinician who is already reading.
    async function load(): Promise<void> {
      try {
        const results = await medplum.searchResources('CarePlan', {
          status: 'draft',
          _sort: '-_lastUpdated',
          _count: '100',
        });
        if (cancelled) return;
        setPlans([...results]);
        setError(undefined);
      } catch (err: unknown) {
        if (!cancelled && first) setError(err instanceof Error ? err.message : 'Could not load plans.');
      } finally {
        if (!cancelled && first) { setLoading(false); first = false; }
      }
    }
    void load();
    const timer = pollMs ? setInterval(load, pollMs) : undefined;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [tick, pollMs]);

  return { plans, loading, error, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

export function usePatients(pollMs = 20000): { patients: Patient[]; refresh: () => void } {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const results = await medplum.searchResources('Patient', { _count: '100', _sort: '-_lastUpdated' });
        if (!cancelled) setPatients([...results]);
      } catch { /* transient — the next tick retries */ }
    }
    void load();
    const timer = pollMs ? setInterval(load, pollMs) : undefined;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [tick, pollMs]);

  return { patients, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

/** Patient reference → display name, resolved once and cached for the session. */
const nameCache = new Map<string, string>();

export function usePatientNames(references: Array<string | undefined>): Map<string, string> {
  const [names, setNames] = useState<Map<string, string>>(new Map(nameCache));
  const key = references.filter(Boolean).sort().join(',');

  useEffect(() => {
    let cancelled = false;
    const missing = [...new Set(references.filter((r): r is string => Boolean(r)))].filter(
      (reference) => !nameCache.has(reference),
    );
    if (missing.length === 0) return;

    void Promise.all(
      missing.map(async (reference) => {
        const id = idFromReference(reference);
        if (!id) return;
        try {
          const patient = await medplum.readResource('Patient', id);
          nameCache.set(reference, displayName(patient));
        } catch {
          nameCache.set(reference, 'Unknown patient');
        }
      }),
    ).then(() => !cancelled && setNames(new Map(nameCache)));

    return () => { cancelled = true; };
  }, [key]);

  return names;
}

export interface CallRecord {
  id: string;
  patientReference?: string;
  when: string;
  status: string;
  direction: string;
}

/** Call log, derived from the charting feed since there is no separate store. */
export function useCalls(pollMs = 15000): CallRecord[] {
  const [calls, setCalls] = useState<CallRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const results = await medplum.searchResources('Communication', {
          category: CATEGORIES.call,
          _sort: '-sent',
          _count: '50',
        });
        if (cancelled) return;
        setCalls(
          [...results].map((communication) => {
            const text = communicationText(communication);
            return {
              id: communication.id ?? '',
              patientReference: communication.subject?.reference,
              when: communication.sent ?? '',
              status: /failed|no-answer|busy/i.test(text) ? 'Failed' : 'Completed',
              direction: /inbound/i.test(text) ? 'Inbound' : 'Outbound',
            };
          }),
        );
      } catch { /* transient — the next tick retries */ }
    }
    void load();
    const timer = pollMs ? setInterval(load, pollMs) : undefined;
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, [pollMs]);

  return calls;
}

/**
 * Live charting feed for one patient.
 *
 * Seeded with a search so the view is populated before the first push arrives,
 * then kept current by polling. Polling rather than FHIR subscriptions because
 * subscriptions need a project-level WebSocket binding that a read-only
 * clinician session may not have; the feed must degrade to *slower*, never to
 * empty.
 */
export function useLiveFeed(patientId: string | undefined, intervalMs = 3000): {
  observations: Observation[];
  chartLines: Communication[];
  live: boolean;
} {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [chartLines, setChartLines] = useState<Communication[]>([]);
  const [live, setLive] = useState(false);
  const lastSeen = useRef<number>(0);

  useEffect(() => {
    if (!patientId) {
      setObservations([]);
      setChartLines([]);
      setLive(false);
      return;
    }
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const [obs, comms] = await Promise.all([
          medplum.searchResources('Observation', {
            subject: `Patient/${patientId}`,
            _sort: '-_lastUpdated',
            _count: '40',
          }),
          medplum.searchResources('Communication', {
            subject: `Patient/${patientId}`,
            _sort: '-sent',
            _count: '60',
          }),
        ]);
        if (cancelled) return;

        const chart = [...comms].filter((c) =>
          c.category?.some((cat) =>
            [CATEGORIES.chart, CATEGORIES.concern, CATEGORIES.education, CATEGORIES.coverage].includes(
              cat.text as never,
            ),
          ),
        );
        setObservations([...obs]);
        setChartLines(chart);

        // "Live" means something was written in the last 30s — that is what
        // makes the indicator honest rather than decorative.
        const newest = Math.max(
          0,
          ...chart.map((c) => new Date(c.sent ?? 0).getTime()),
          ...obs.map((o) => new Date(o.effectiveDateTime ?? o.issued ?? 0).getTime()),
        );
        lastSeen.current = newest;
        setLive(Date.now() - newest < 30_000);
      } catch {
        /* transient — the next tick retries */
      }
    }

    void poll();
    const timer = setInterval(poll, intervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [patientId, intervalMs]);

  return { observations, chartLines, live };
}

/** Everything the review screen needs for one plan. */
export function useReviewData(plan: CarePlan | undefined, reloadKey = 0): {
  patient?: Patient;
  medications: MedicationRequest[];
  communications: Communication[];
  scores: Observation[];
  task?: Task;
  loading: boolean;
} {
  const [patient, setPatient] = useState<Patient>();
  const [medications, setMedications] = useState<MedicationRequest[]>([]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [scores, setScores] = useState<Observation[]>([]);
  const [task, setTask] = useState<Task>();
  const [loading, setLoading] = useState(false);

  const patientId = idFromReference(plan?.subject?.reference);

  useEffect(() => {
    if (!plan || !patientId) return;
    let cancelled = false;
    setLoading(true);

    const medicationIds = (plan.activity ?? [])
      .map((activity) => activity.reference?.reference)
      .filter((ref): ref is string => Boolean(ref?.startsWith('MedicationRequest/')))
      .map((ref) => ref.split('/')[1])
      .filter((id): id is string => Boolean(id));

    void Promise.all([
      medplum.readResource('Patient', patientId).catch(() => undefined),
      Promise.all(
        medicationIds.map((id) =>
          medplum.readResource('MedicationRequest', id).catch(() => undefined),
        ),
      ),
      medplum.searchResources('Communication', {
        subject: `Patient/${patientId}`,
        _sort: '-sent',
        _count: '100',
      }),
      medplum.searchResources('Observation', {
        subject: `Patient/${patientId}`,
        status: 'final',
        _sort: 'date',
        _count: '60',
      }),
      medplum.searchResources('Task', { focus: `CarePlan/${plan.id}` }).catch(() => []),
    ])
      .then(([p, meds, comms, obs, tasks]) => {
        if (cancelled) return;
        setPatient(p);
        setMedications(meds.filter((m): m is MedicationRequest => Boolean(m)));
        setCommunications([...comms]);
        setScores([...obs].filter((o) => o.valueQuantity?.unit === '{score}'));
        setTask(tasks[0]);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, [plan?.id, patientId, reloadKey]);

  return { patient, medications, communications, scores, task, loading };
}

/** Plan rows enriched with the patient name and triage priority. */
export function usePlanSummaries(plans: CarePlan[]): Array<{
  plan: CarePlan;
  name: string;
  priority: Priority;
}> {
  const references = useMemo(() => plans.map((p) => p.subject?.reference), [plans]);
  const names = usePatientNames(references);
  const [safety, setSafety] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      plans.map(async (plan) => {
        const patientId = idFromReference(plan.subject?.reference);
        if (!patientId || !plan.id) return [plan.id ?? '', ''] as const;
        try {
          const comms = await medplum.searchResources('Communication', {
            subject: `Patient/${patientId}`,
            category: CATEGORIES.safety,
            _sort: '-sent',
            _count: '5',
          });
          return [plan.id, comms.map(communicationText).join('\n')] as const;
        } catch {
          return [plan.id, ''] as const;
        }
      }),
    ).then((entries) => !cancelled && setSafety(new Map(entries)));
    return () => { cancelled = true; };
  }, [plans.map((p) => p.id).join(',')]);

  return plans.map((plan) => ({
    plan,
    name: names.get(plan.subject?.reference ?? '') ?? 'Loading…',
    priority: priorityOf({ safetyText: safety.get(plan.id ?? '') ?? '' }),
  }));
}

/**
 * Every care plan for one patient, newest first.
 *
 * The patient hub needs both drafts and active plans in one place, so unlike
 * `useDraftPlans` this is not filtered by status — the caller decides how to
 * group them.
 */
export function usePatientPlans(patientId: string | undefined): {
  plans: CarePlan[];
  loading: boolean;
} {
  const [plans, setPlans] = useState<CarePlan[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!patientId) {
      setPlans([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    medplum
      .searchResources('CarePlan', {
        subject: `Patient/${patientId}`,
        _sort: '-_lastUpdated',
        _count: '50',
      })
      .then((results) => !cancelled && setPlans([...results]))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [patientId]);

  return { plans, loading };
}

export async function saveMedication(request: MedicationRequest): Promise<MedicationRequest> {
  return medplum.updateResource(request);
}

export function hasCriticalFlag(communications: Communication[]): boolean {
  return byCategory(communications, CATEGORIES.safety).some((c) =>
    communicationText(c).toLowerCase().includes('[critical]'),
  );
}
