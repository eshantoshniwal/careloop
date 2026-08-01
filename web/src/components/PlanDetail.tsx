import type {
  CarePlan,
  Communication,
  MedicationRequest,
  Observation,
  Patient,
} from '@medplum/fhirtypes';
import { useEffect, useMemo, useState } from 'react';
import { approve } from '../bridge';
import {
  CATEGORIES,
  byCategory,
  communicationText,
  fetchCommunications,
  fetchMedications,
  fetchPatient,
  fetchScoreHistory,
  hasCriticalFlag,
  saveMedication,
} from '../data';
import { Trend } from './Trend';

function severityOf(line: string): 'critical' | 'warning' | 'info' {
  const lower = line.toLowerCase();
  if (lower.includes('[critical]')) return 'critical';
  if (lower.includes('[warning]')) return 'warning';
  return 'info';
}

function MedicationRow({
  request,
  editable,
  onSaved,
}: {
  request: MedicationRequest;
  editable: boolean;
  onSaved: () => void;
}): JSX.Element {
  const coding = request.medicationCodeableConcept?.coding?.[0];
  const [display, setDisplay] = useState(coding?.display ?? '');
  const [code, setCode] = useState(coding?.code ?? '');
  const [sig, setSig] = useState(request.dosageInstruction?.[0]?.text ?? '');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await saveMedication({
        ...request,
        medicationCodeableConcept: {
          coding: [
            {
              system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
              code,
              display,
            },
          ],
          text: display,
        },
        dosageInstruction: [{ ...(request.dosageInstruction?.[0] ?? {}), text: sig }],
      });
      setDirty(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return (
      <tr>
        <td>{display}</td>
        <td className="mono">{code}</td>
        <td>{sig}</td>
        <td><span className="badge ok">{request.status}</span></td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <input
          value={display}
          aria-label="Medication"
          onChange={(e) => { setDisplay(e.target.value); setDirty(true); }}
        />
      </td>
      <td style={{ width: 120 }}>
        <input
          value={code}
          aria-label="RxNorm code"
          className="mono"
          onChange={(e) => { setCode(e.target.value); setDirty(true); }}
        />
      </td>
      <td>
        <input
          value={sig}
          aria-label="Directions"
          onChange={(e) => { setSig(e.target.value); setDirty(true); }}
        />
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </td>
    </tr>
  );
}

export function PlanDetail({
  plan,
  onApproved,
}: {
  plan: CarePlan;
  onApproved: () => void;
}): JSX.Element {
  const [patient, setPatient] = useState<Patient>();
  const [medications, setMedications] = useState<MedicationRequest[]>([]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [scores, setScores] = useState<Observation[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();
  const [reloadKey, setReloadKey] = useState(0);

  const patientId = plan.subject?.reference?.split('/')[1] ?? '';

  useEffect(() => {
    let cancelled = false;
    setAcknowledged(false);
    setMessage(undefined);

    void (async () => {
      const [p, meds, comms, obs] = await Promise.all([
        fetchPatient(plan.subject?.reference),
        fetchMedications(plan),
        patientId ? fetchCommunications(patientId) : Promise.resolve([]),
        patientId ? fetchScoreHistory(patientId) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setPatient(p);
      setMedications(meds);
      setCommunications(comms);
      setScores(obs);
    })();

    return () => { cancelled = true; };
  }, [plan.id, patientId, reloadKey]);

  const critical = useMemo(() => hasCriticalFlag(communications), [communications]);
  const isDraft = plan.status === 'draft';

  const safetyLines = byCategory(communications, CATEGORIES.safety)
    .flatMap((c) => communicationText(c).split('\n'))
    .filter(Boolean);

  const chartLines = byCategory(communications, CATEGORIES.chart).map(communicationText);
  const concerns = byCategory(communications, CATEGORIES.concern).map(communicationText);
  const research = byCategory(communications, CATEGORIES.research).map(communicationText);
  const panel = byCategory(communications, CATEGORIES.panel);
  const coverage = byCategory(communications, CATEGORIES.coverage).map(communicationText);
  const recap = byCategory(communications, CATEGORIES.recap).map(communicationText);

  const trendPoints = scores.map((obs) => ({
    date: obs.effectiveDateTime ?? obs.issued ?? '',
    total: obs.valueQuantity?.value ?? 0,
  }));
  const trendMax = Math.max(25, ...trendPoints.map((p) => p.total));

  async function onApprove(): Promise<void> {
    if (!plan.id) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await approve({
        carePlanId: plan.id,
        hasCriticalFlag: critical,
        acknowledgedCriticalFlags: acknowledged,
      });
      if (result.approved) {
        setMessage({ kind: 'ok', text: 'Plan approved. Medications are now active.' });
        onApproved();
      } else {
        setMessage({ kind: 'error', text: result.reason ?? 'Approval was refused.' });
      }
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Approval failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="panel">
        <h2>
          {plan.title ?? 'Care plan'}{' '}
          <span className={`badge ${isDraft ? 'draft' : 'ok'}`}>{plan.status}</span>
        </h2>
        <p className="small muted">
          {patient?.name?.[0]
            ? `${patient.name[0].given?.join(' ') ?? ''} ${patient.name[0].family ?? ''}`.trim()
            : patientId}
          {patient?.birthDate ? ` · DOB ${patient.birthDate}` : ''}
          {plan.created ? ` · drafted ${plan.created.slice(0, 10)}` : ''}
        </p>
        <p>{plan.description}</p>
        {plan.note?.map((note, i) => (
          <p key={i} className="small muted">{note.text}</p>
        ))}
        {plan.replaces?.length ? (
          <p className="small muted">Replaces {plan.replaces.length} previous active plan(s).</p>
        ) : null}
      </div>

      <div className="panel">
        <h2>Score trend</h2>
        <Trend points={trendPoints} min={0} max={trendMax} higherIsBetter={trendMax <= 25} />
      </div>

      <div className="panel">
        <h2>Drafted regimen</h2>
        {medications.length === 0 ? (
          <p className="small muted">This protocol step drafts no medication.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Medication</th>
                <th>RxNorm</th>
                <th>Directions</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {medications.map((request) => (
                <MedicationRow
                  key={request.id}
                  request={request}
                  editable={isDraft}
                  onSaved={() => setReloadKey((k) => k + 1)}
                />
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>
          RxNorm codes are drafted from the module's seed formulary. Confirm the code before
          approving.
        </p>
      </div>

      <div className="panel">
        <h2>Safety and risk</h2>
        {safetyLines.length === 0 ? (
          <p className="small muted">No findings recorded.</p>
        ) : (
          safetyLines.map((line, i) => (
            <div key={i} className={`finding ${severityOf(line)}`}>
              <span className={`badge ${severityOf(line)}`}>{severityOf(line)}</span>{' '}
              {line.replace(/^\[[a-z]+\]\s*/i, '')}
            </div>
          ))
        )}
      </div>

      {concerns.length > 0 && (
        <div className="panel">
          <h2>Patient concerns</h2>
          {concerns.map((text, i) => <p key={i}>{text}</p>)}
        </div>
      )}

      <div className="panel">
        <h2>Evidence</h2>
        {research.length === 0 ? (
          <p className="small muted">No evidence artifact was written for this plan.</p>
        ) : (
          research.map((text, i) => <pre className="artifact" key={i}>{text}</pre>)
        )}
      </div>

      <div className="panel">
        <h2>Expert panel</h2>
        {panel.length === 0 ? (
          <p className="small muted">The expert panel did not run for this plan.</p>
        ) : (
          panel.map((communication, i) => (
            <div key={i}>
              <p className="small muted">{communication.topic?.text}</p>
              <pre className="artifact">{communicationText(communication)}</pre>
            </div>
          ))
        )}
        <p className="small muted">
          These are model personas, not a licensed clinical sign-off. You remain the sole approver.
        </p>
      </div>

      {coverage.length > 0 && (
        <div className="panel">
          <h2>Coverage</h2>
          {coverage.map((text, i) => <pre className="artifact" key={i}>{text}</pre>)}
          <p className="small muted">
            Eligibility is not a formulary check and does not guarantee payment.
          </p>
        </div>
      )}

      {recap.length > 0 && (
        <div className="panel">
          <h2>Patient recap</h2>
          {recap.map((text, i) => <p key={i}>{text}</p>)}
        </div>
      )}

      {chartLines.length > 0 && (
        <div className="panel">
          <h2>Chart timeline</h2>
          {chartLines.map((line, i) => (
            <p key={i} className="small mono">{line}</p>
          ))}
        </div>
      )}

      {isDraft && (
        <div className="panel">
          <h2>Approval</h2>
          {critical && (
            <div className="ack">
              <label>
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <span>
                  <strong>This plan has a critical safety flag.</strong> I have reviewed the finding
                  above and accept clinical responsibility for approving this plan.
                </span>
              </label>
            </div>
          )}
          {message && <div className={`notice ${message.kind}`}>{message.text}</div>}
          <button
            className="primary"
            onClick={onApprove}
            disabled={busy || (critical && !acknowledged)}
          >
            {busy ? 'Approving…' : 'Approve plan'}
          </button>
          <p className="small muted" style={{ marginTop: 10 }}>
            Approval sets the CarePlan and every drafted medication to active and completes the
            review task.
          </p>
        </div>
      )}
    </div>
  );
}
