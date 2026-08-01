import type { CarePlan, MedicationRequest } from '@medplum/fhirtypes';
import { useState } from 'react';
import { approve } from '../bridge';
import {
  CATEGORIES,
  byCategory,
  communicationText,
  displayName,
  hasCriticalFlag,
  saveMedication,
  useReviewData,
  usePlanSummaries,
} from '../data';
import { Trend } from '../components/Trend';
import { Avatar, Badge, Card, Empty, Icon, clockTime, relativeTime } from '../ui';

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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await saveMedication({
        ...request,
        medicationCodeableConcept: {
          coding: [
            { system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code, display },
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
        <td><Badge tone="ok">{request.status}</Badge></td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <input aria-label="Medication" value={display}
          onChange={(e) => { setDisplay(e.target.value); setDirty(true); }} />
      </td>
      <td style={{ width: 130 }}>
        <input aria-label="RxNorm code" className="mono" value={code}
          onChange={(e) => { setCode(e.target.value); setDirty(true); }} />
      </td>
      <td>
        <input aria-label="Directions" value={sig}
          onChange={(e) => { setSig(e.target.value); setDirty(true); }} />
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="btn" onClick={save} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </td>
    </tr>
  );
}

export function ReviewPage({
  plans,
  selected,
  onSelect,
  onChanged,
}: {
  plans: CarePlan[];
  selected?: CarePlan;
  onSelect: (plan: CarePlan) => void;
  onChanged: () => void;
}): JSX.Element {
  const summaries = usePlanSummaries(plans);
  const plan = selected ?? plans[0];
  const [reloadKey, setReloadKey] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string }>();

  const { patient, medications, communications, scores, task } = useReviewData(plan, reloadKey);

  const critical = hasCriticalFlag(communications);
  const isDraft = plan?.status === 'draft';

  const safetyLines = byCategory(communications, CATEGORIES.safety)
    .flatMap((c) => communicationText(c).split('\n'))
    .filter(Boolean);
  const concerns = byCategory(communications, CATEGORIES.concern).map(communicationText);
  const research = byCategory(communications, CATEGORIES.research).map(communicationText);
  const panel = byCategory(communications, CATEGORIES.panel);
  const coverage = byCategory(communications, CATEGORIES.coverage).map(communicationText);
  const recap = byCategory(communications, CATEGORIES.recap).map(communicationText);
  const chart = byCategory(communications, CATEGORIES.chart);

  const trendPoints = scores.map((obs) => ({
    date: obs.effectiveDateTime ?? obs.issued ?? '',
    total: obs.valueQuantity?.value ?? 0,
  }));
  const trendMax = Math.max(25, ...trendPoints.map((p) => p.total));

  async function onApprove(): Promise<void> {
    if (!plan?.id) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await approve({
        carePlanId: plan.id,
        hasCriticalFlag: critical,
        acknowledgedCriticalFlags: acknowledged,
      });
      if (result.approved) {
        setMessage({ kind: 'ok', text: 'Approved. The plan and every medication are now active.' });
        onChanged();
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

  const patientName = patient ? displayName(patient) : 'Loading…';

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Review queue</h1>
          <p className="sub">
            {plans.length} draft plan{plans.length === 1 ? '' : 's'} awaiting a clinician.
          </p>
        </div>
      </header>

      <div className="grid-review">
        <Card title="Drafts">
          {summaries.length === 0 ? (
            <Empty>Nothing waiting for review.</Empty>
          ) : (
            summaries.map(({ plan: p, name, priority }) => (
              <button
                key={p.id}
                className={`row ${p.id === plan?.id ? 'selected' : ''}`}
                onClick={() => { onSelect(p); setAcknowledged(false); setMessage(undefined); }}
              >
                <Avatar name={name} small />
                <span className="grow">
                  <span className="name">{name}</span>
                  <span className="meta">{relativeTime(p.created)}</span>
                </span>
                <Badge tone={priority}>{priority}</Badge>
              </button>
            ))
          )}
        </Card>

        {!plan ? (
          <Card padded>
            <Empty>Select a draft plan to review it.</Empty>
          </Card>
        ) : (
          <div className="stack">
            {/* 1 — summary */}
            <Card padded>
              <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <Avatar name={patientName} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 style={{ fontSize: 19 }}>{patientName}</h2>
                  <p className="small muted" style={{ marginTop: 3 }}>
                    {patient?.birthDate ? `DOB ${patient.birthDate} · ` : ''}
                    drafted {relativeTime(plan.created)}
                  </p>
                </div>
                <Badge tone={isDraft ? 'routine' : 'ok'}>{plan.status}</Badge>
                {task?.priority === 'urgent' && <Badge tone="urgent">urgent task</Badge>}
              </div>
              <p style={{ marginTop: 16, fontWeight: 600 }}>{plan.title}</p>
              <p className="muted" style={{ marginTop: 6 }}>{plan.description}</p>
              {plan.note?.map((note, i) => (
                <p key={i} className="small muted" style={{ marginTop: 8 }}>{note.text}</p>
              ))}
              {plan.replaces?.length ? (
                <p className="small muted" style={{ marginTop: 8 }}>
                  Replaces {plan.replaces.length} previous active plan
                  {plan.replaces.length === 1 ? '' : 's'}.
                </p>
              ) : null}
            </Card>

            {/* 2 — trend */}
            <Card title="Score trend" subtitle="Finalised total scores over time" padded>
              <Trend points={trendPoints} min={0} max={trendMax} higherIsBetter={trendMax <= 25} />
            </Card>

            {/* 3 — safety and risk */}
            <Card title="Safety and risk" subtitle={`${safetyLines.length} finding${safetyLines.length === 1 ? '' : 's'}`}>
              {safetyLines.length === 0 ? (
                <Empty>No findings recorded.</Empty>
              ) : (
                safetyLines.map((line, i) => (
                  <div key={i} className={`finding ${severityOf(line)}`}>
                    <span className="bar" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Badge tone={severityOf(line) === 'warning' ? 'urgent' : severityOf(line) === 'critical' ? 'critical' : 'info'}>
                        {severityOf(line)}
                      </Badge>
                      <span style={{ display: 'block', marginTop: 5 }}>
                        {line.replace(/^\[[a-z]+\]\s*/i, '')}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </Card>

            {/* 4 — regimen */}
            <Card title="Drafted regimen" subtitle="Editable until approved">
              {medications.length === 0 ? (
                <Empty>This protocol step drafts no medication.</Empty>
              ) : (
                <table>
                  <thead>
                    <tr><th>Medication</th><th>RxNorm</th><th>Directions</th><th /></tr>
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
              <p className="small muted" style={{ padding: '14px 24px 18px' }}>
                RxNorm codes come from the module's seed formulary. Confirm the code before
                approving.
              </p>
            </Card>

            {/* 5 — concerns */}
            {concerns.length > 0 && (
              <Card title="Patient concerns" subtitle="In the patient's own words">
                {concerns.map((text, i) => (
                  <div key={i} className="finding info">
                    <span className="bar" />
                    <span>{text}</span>
                  </div>
                ))}
              </Card>
            )}

            {/* 6 — evidence */}
            <Card title="Evidence" subtitle="Off-call synthesis, grounded in the condition corpus" padded>
              {research.length === 0 ? (
                <Empty>No evidence artifact was written for this plan.</Empty>
              ) : (
                research.map((text, i) => <pre className="artifact" key={i}>{text}</pre>)
              )}
            </Card>

            {/* 7 — peer review */}
            <Card title="Expert panel" subtitle="Decision support — not a clinical sign-off" padded>
              {panel.length === 0 ? (
                <Empty>The expert panel did not run for this plan.</Empty>
              ) : (
                panel.map((communication, i) => (
                  <div key={i}>
                    {communication.topic?.text && (
                      <p className="small muted" style={{ marginBottom: 8 }}>
                        {communication.topic.text}
                      </p>
                    )}
                    <pre className="artifact">{communicationText(communication)}</pre>
                  </div>
                ))
              )}
              <p className="small muted" style={{ marginTop: 12 }}>
                These are model personas, not licensed clinicians. You remain the sole approver.
              </p>
            </Card>

            {/* 8 — coverage */}
            {coverage.length > 0 && (
              <Card title="Coverage" subtitle="Eligibility is not a formulary check" padded>
                {coverage.map((text, i) => <pre className="artifact" key={i}>{text}</pre>)}
              </Card>
            )}

            {/* 9 — recap + charting timeline */}
            {recap.length > 0 && (
              <Card title="Patient recap" subtitle="What the patient was told" padded>
                {recap.map((text, i) => <p key={i}>{text}</p>)}
              </Card>
            )}

            {chart.length > 0 && (
              <Card title="Charting timeline" subtitle={`${chart.length} entries written during the call`}>
                {chart.slice(0, 30).map((line) => (
                  <div key={line.id} className="feed-item">
                    <span className="feed-time">{clockTime(line.sent)}</span>
                    <span>{communicationText(line)}</span>
                  </div>
                ))}
              </Card>
            )}

            {/* approval */}
            {isDraft && (
              <Card title="Approval" padded>
                {critical && (
                  <div className="ack">
                    <label>
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                      />
                      <span>
                        <strong>This plan has a critical safety flag.</strong> I have reviewed the
                        finding above and accept clinical responsibility for approving this plan.
                      </span>
                    </label>
                  </div>
                )}
                {message && <div className={`notice ${message.kind}`}>{message.text}</div>}
                <button
                  className="btn primary"
                  onClick={onApprove}
                  disabled={busy || (critical && !acknowledged)}
                  style={{ marginTop: message ? 14 : 0 }}
                >
                  {Icon.check()} {busy ? 'Approving…' : 'Approve plan'}
                </button>
                <p className="small muted" style={{ marginTop: 12 }}>
                  Approval sets the CarePlan and every drafted medication to active, and completes
                  the review task.
                </p>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
