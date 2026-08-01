import type { CarePlan } from '@medplum/fhirtypes';
import { useMemo, useState } from 'react';
import { BandMeter, DeltaBadge, ScoreTrendChart, SeverityBar, type Segment } from '../clinical/charts';
import { bandForScore, scaleForText, toneMark, toneVars } from '../clinical/scale';
import { triage, type TriageLevel } from '../clinical/triage';
import { usePlanQueue, type EnrichedPlan } from '../data';
import { Avatar, Badge, Card, Chip, Empty, Icon, MetricStrip, Modal, Skeleton, relativeTime, type Tone } from '../ui';

const CONSENSUS_LABEL: Record<string, string> = {
  revise: 'Revise before approval',
  'approve-with-notes': 'Approve with notes',
  'approve-as-drafted': 'Approve as drafted',
};
const CONSENSUS_TONE: Record<string, Tone> = {
  revise: 'critical',
  'approve-with-notes': 'urgent',
  'approve-as-drafted': 'ok',
};

const LEVEL_TONE: Record<TriageLevel, Tone> = { critical: 'critical', urgent: 'urgent', routine: 'routine' };

type Sort = 'urgent' | 'newest' | 'oldest';

/**
 * The review queue as a triage board.
 *
 * Every card answers, without a click: how bad is this, why is it flagged,
 * where is the score on the instrument, which way is it moving, and what does
 * the panel think. The ranking is the product — see `clinical/triage.ts`.
 */
export function ReviewQueuePage({
  plans,
  loading,
  onOpenPlan,
}: {
  plans: CarePlan[];
  loading?: boolean;
  onOpenPlan: (plan: CarePlan) => void;
}): JSX.Element {
  const { rows } = usePlanQueue(plans);
  const [filter, setFilter] = useState<'all' | TriageLevel>('all');
  const [sort, setSort] = useState<Sort>('urgent');
  const [preview, setPreview] = useState<EnrichedPlan>();
  const [hoveredDot, setHoveredDot] = useState<string>();

  const triaged = useMemo(
    () =>
      rows.map((row) => {
        const scale = scaleForText(row.conditionText ?? row.plan.title);
        return {
          row,
          scale,
          t: triage({
            created: row.plan.created,
            safetyCritical: row.safetyCritical,
            safetyWarning: row.safetyWarning,
            consensus: row.consensus,
            scale,
            scoreTotal: row.scoreTotal,
            priorScores: row.priorScores,
            priorAuthRequired: row.priorAuthRequired,
            covered: row.covered,
          }),
        };
      }),
    [rows],
  );

  const counts = {
    critical: triaged.filter((x) => x.t.level === 'critical').length,
    urgent: triaged.filter((x) => x.t.level === 'urgent').length,
    routine: triaged.filter((x) => x.t.level === 'routine').length,
  };

  const shown = triaged
    .filter((x) => filter === 'all' || x.t.level === filter)
    .sort((a, b) =>
      sort === 'urgent'
        ? a.t.rank - b.t.rank
        : sort === 'newest'
          ? (b.row.plan.created ?? '').localeCompare(a.row.plan.created ?? '')
          : (a.row.plan.created ?? '').localeCompare(b.row.plan.created ?? ''),
    );

  // Aggregate visuals — each instrument keeps its own scale, never merged.
  const instrumentGroups = useMemo(() => {
    const map = new Map<string, Array<{ name: string; total: number }>>();
    for (const { row, scale } of triaged) {
      if (row.scoreTotal == null) continue;
      const list = map.get(scale.instrument) ?? [];
      list.push({ name: row.name, total: row.scoreTotal });
      map.set(scale.instrument, list);
    }
    return [...map.entries()].map(([instrument, patients]) => ({
      scale: triaged.find((x) => x.scale.instrument === instrument)!.scale,
      patients,
    }));
  }, [triaged]);

  const consensusSegments: Segment[] = useMemo(() => {
    const map = new Map<string, number>();
    for (const { row } of triaged) if (row.consensus) map.set(row.consensus, (map.get(row.consensus) ?? 0) + 1);
    return ['approve-as-drafted', 'approve-with-notes', 'revise']
      .filter((k) => map.has(k))
      .map((k) => ({
        key: k,
        label: CONSENSUS_LABEL[k] ?? k,
        count: map.get(k)!,
        tone: k === 'revise' ? 'red' : k === 'approve-with-notes' ? 'amber' : 'green',
      }));
  }, [triaged]);

  const criticalFlags = triaged.reduce((s, x) => s + x.row.safetyCritical, 0);
  const coverageBlocked = triaged.filter((x) => x.row.priorAuthRequired || x.row.covered === false).length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Review queue</h1>
          <p className="sub">
            {plans.length} voice-charted draft plan{plans.length === 1 ? '' : 's'} ready for clinician
            sign-off — sorted by who needs you most.
          </p>
        </div>
      </header>

      <div style={{ marginBottom: 16 }}>
        <MetricStrip
          items={[
            { label: 'Awaiting review', value: plans.length, tone: 'brand' },
            { label: 'Critical', value: counts.critical, tone: counts.critical ? 'critical' : 'routine' },
            { label: 'Urgent', value: counts.urgent, tone: counts.urgent ? 'urgent' : 'routine' },
            { label: 'Routine', value: counts.routine, tone: 'ok' },
          ]}
        />
      </div>

      {/* Queue at a glance — the whole panel, per instrument. */}
      {instrumentGroups.length > 0 && (
        <Card title="Queue at a glance" subtitle="Clinical picture across every draft plan" padded>
          {instrumentGroups.map(({ scale, patients }) => {
            const span = scale.max - scale.min || 1;
            return (
              <div key={scale.instrument} style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9 }}>
                  <strong style={{ fontSize: 14 }}>{scale.instrumentLong}</strong>
                  <span className="muted small">({scale.instrument})</span>
                  <span style={{ flex: 1 }} />
                  <span className="muted small">{patients.length} patient{patients.length === 1 ? '' : 's'}</span>
                </div>
                <div className="qi-track">
                  {scale.bands.map((b) => (
                    <span
                      key={b.id}
                      className="qi-band"
                      style={{ width: `${((b.max - b.min + 1) / (span + 1)) * 100}%`, background: toneVars(b.tone).bg }}
                    />
                  ))}
                  {patients.map((p, i) => {
                    const key = `${scale.instrument}-${p.name}-${i}`;
                    const pct = ((p.total - scale.min) / span) * 100;
                    return (
                      <span
                        key={key}
                        className={`qi-dot${hoveredDot === key ? ' active' : ''}`}
                        style={{ left: `${pct}%` }}
                        tabIndex={0}
                        role="img"
                        aria-label={`${p.name}: ${scale.instrument} ${p.total} — ${bandForScore(scale, p.total).label}`}
                        onMouseEnter={() => setHoveredDot(key)}
                        onMouseLeave={() => setHoveredDot((c) => (c === key ? undefined : c))}
                        onFocus={() => setHoveredDot(key)}
                        onBlur={() => setHoveredDot((c) => (c === key ? undefined : c))}
                      >
                        {hoveredDot === key && (
                          // Anchored above the track so it never covers the legend
                          // underneath, and flipped inward at the extremes.
                          <span
                            className="qi-tip"
                            style={pct > 70 ? { right: 0, transform: 'none' } : pct < 30 ? { left: 0, transform: 'none' } : undefined}
                          >
                            <strong>{p.name}</strong>
                            {` · ${scale.instrument} ${p.total} — ${bandForScore(scale, p.total).label}`}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
                <div className="sevbar-legend" style={{ marginTop: 9 }}>
                  {scale.bands.map((b) => (
                    <span key={b.id} className="sevbar-legend-item">
                      <i style={{ background: toneMark(b.tone) }} />{b.label}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="qi-secondary">
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 9 }}>
                <strong style={{ fontSize: 14 }}>Expert consensus</strong>
                <span style={{ flex: 1 }} />
                <span className="muted small">peer panel</span>
              </div>
              {consensusSegments.length === 0 ? (
                <p className="small muted">No peer review on file yet.</p>
              ) : (
                <SeverityBar segments={consensusSegments} />
              )}
            </div>
            <div className="qi-metrics">
              <div><span className="qm-v">{criticalFlags}</span><span className="qm-l">Critical flags</span></div>
              <div><span className="qm-v">{coverageBlocked}</span><span className="qm-l">Coverage blocked</span></div>
              <div><span className="qm-v">{counts.critical + counts.urgent}</span><span className="qm-l">Need attention</span></div>
            </div>
          </div>
        </Card>
      )}

      {/* Filters + sort */}
      <div className="queue-controls">
        <div className="chips">
          <span className="small muted">Show</span>
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All ({plans.length})</Chip>
          <Chip active={filter === 'critical'} onClick={() => setFilter('critical')}>Critical ({counts.critical})</Chip>
          <Chip active={filter === 'urgent'} onClick={() => setFilter('urgent')}>Urgent ({counts.urgent})</Chip>
          <Chip active={filter === 'routine'} onClick={() => setFilter('routine')}>Routine ({counts.routine})</Chip>
        </div>
        <div style={{ flex: 1 }} />
        <label className="sort-field">
          <span className="small muted">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort the queue">
            <option value="urgent">Most urgent first</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
      </div>

      {loading && rows.length === 0 ? (
        <Card><Skeleton rows={4} /></Card>
      ) : plans.length === 0 ? (
        <Card>
          <Empty title="Queue is clear">
            A draft plan appears here within about 15 seconds of a check-in call ending.
          </Empty>
        </Card>
      ) : shown.length === 0 ? (
        <Card><Empty>No {filter} plans in the queue.</Empty></Card>
      ) : (
        <div className="queue-grid">
          {shown.map(({ row, scale, t }) => {
            const band = row.scoreTotal != null ? bandForScore(scale, row.scoreTotal) : undefined;
            return (
              <article key={row.plan.id} className={`qcard ${t.level}`}>
                <header className="qcard-head">
                  <Avatar name={row.name} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3>{row.name}</h3>
                    <p className="small muted">{row.plan.title ?? 'Care plan'}</p>
                  </div>
                  <Badge tone={LEVEL_TONE[t.level]}>{t.level}</Badge>
                </header>

                {t.reasons.length > 0 && (
                  <ul className="qcard-reasons">
                    {t.reasons.slice(0, 3).map((r) => <li key={r.code}>{r.label}</li>)}
                    {t.reasons.length > 3 && <li className="muted">+{t.reasons.length - 3} more</li>}
                  </ul>
                )}

                {row.scoreTotal != null && (
                  <div style={{ margin: '14px 0 4px' }}>
                    <BandMeter scale={scale} total={row.scoreTotal} />
                  </div>
                )}

                <div className="qcard-facts">
                  <div><span className="l">Medication</span><span className="v">{row.medicationCount} in plan</span></div>
                  <div>
                    <span className="l">Experts</span>
                    <span className="v">
                      {row.panelTotal ? `${row.panelAgree ?? 0}/${row.panelTotal} agree` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="l">Est. copay</span>
                    <span className="v">
                      {row.copayUsd != null ? `$${row.copayUsd}` : '—'}
                      {row.priorAuthRequired && <span className="pa"> · PA</span>}
                    </span>
                  </div>
                  <div>
                    <span className="l">Trend</span>
                    <span className="v">
                      {row.trendPoints.length > 1 ? <DeltaBadge points={row.trendPoints} scale={scale} /> : '—'}
                    </span>
                  </div>
                </div>

                {row.consensus && (
                  <div style={{ marginTop: 12 }}>
                    <Badge tone={CONSENSUS_TONE[row.consensus] ?? 'info'}>
                      {CONSENSUS_LABEL[row.consensus] ?? row.consensus}
                    </Badge>
                  </div>
                )}

                {row.recap && <blockquote className="qcard-quote">{row.recap}</blockquote>}

                <footer className="qcard-foot">
                  <span className="small muted">{relativeTime(row.plan.created)}</span>
                  <div style={{ flex: 1 }} />
                  <button className="btn" onClick={() => setPreview(row)}>Preview</button>
                  <button className="btn primary" onClick={() => onOpenPlan(row.plan)}>
                    Open review {Icon.arrowRight()}
                  </button>
                </footer>
                {band && <span className="qcard-edge" style={{ background: toneMark(band.tone) }} />}
              </article>
            );
          })}
        </div>
      )}

      {preview && (
        <PreviewModal
          row={preview}
          onClose={() => setPreview(undefined)}
          onOpen={() => { onOpenPlan(preview.plan); setPreview(undefined); }}
        />
      )}
    </>
  );
}

function PreviewModal({
  row,
  onClose,
  onOpen,
}: {
  row: EnrichedPlan;
  onClose: () => void;
  onOpen: () => void;
}): JSX.Element {
  const scale = scaleForText(row.conditionText ?? row.plan.title);
  const t = triage({
    created: row.plan.created,
    safetyCritical: row.safetyCritical,
    safetyWarning: row.safetyWarning,
    consensus: row.consensus,
    scale,
    scoreTotal: row.scoreTotal,
    priorScores: row.priorScores,
    priorAuthRequired: row.priorAuthRequired,
    covered: row.covered,
  });

  return (
    <Modal
      title={row.name}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={onOpen}>Open full review {Icon.arrowRight()}</button>
        </>
      }
    >
      <p className="small muted" style={{ marginBottom: 16 }}>{row.plan.title}</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Badge tone={LEVEL_TONE[t.level]}>{t.level}</Badge>
        <strong style={{ fontSize: 14 }}>Why this plan needs attention</strong>
      </div>
      <ul className="qcard-reasons" style={{ marginBottom: 18 }}>
        {t.reasons.map((r) => <li key={r.code}>{r.label}</li>)}
        {t.reasons.length === 0 && <li className="muted">No flags — routine review.</li>}
      </ul>

      {row.scoreTotal != null && (
        <>
          <strong style={{ fontSize: 14 }}>{scale.instrumentLong}</strong>
          <div style={{ margin: '10px 0 18px' }}>
            <BandMeter scale={scale} total={row.scoreTotal} showTicks />
          </div>
        </>
      )}

      {row.trendPoints.length > 1 && (
        <div style={{ marginBottom: 18 }}>
          <ScoreTrendChart points={row.trendPoints} scale={scale} height={180} />
        </div>
      )}

      {row.safetyLines.length > 0 && (
        <>
          <strong style={{ fontSize: 14 }}>Safety &amp; risk</strong>
          <div style={{ marginTop: 8 }}>
            {row.safetyLines.slice(0, 4).map((line, i) => (
              <p key={i} className="small" style={{ marginTop: 6 }}>{line.replace(/^\[[a-z]+\]\s*/i, '')}</p>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
