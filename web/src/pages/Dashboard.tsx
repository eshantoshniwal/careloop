import type { CarePlan, Patient } from '@medplum/fhirtypes';
import type { Route } from '../App';
import { useCalls, usePatientNames, usePlanSummaries, type Priority } from '../data';
import { Avatar, Badge, Card, Empty, Icon, Stat, relativeTime } from '../ui';

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, urgent: 1, routine: 2 };

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage({
  plans,
  patients,
  onOpenPlan,
  onNavigate,
}: {
  plans: CarePlan[];
  patients: Patient[];
  onOpenPlan: (plan: CarePlan) => void;
  onNavigate: (route: Route) => void;
}): JSX.Element {
  const summaries = usePlanSummaries(plans);
  const calls = useCalls();
  const callNames = usePatientNames(calls.map((c) => c.patientReference));

  const counts = {
    critical: summaries.filter((s) => s.priority === 'critical').length,
    urgent: summaries.filter((s) => s.priority === 'urgent').length,
    routine: summaries.filter((s) => s.priority === 'routine').length,
  };
  const needsAttention = counts.critical + counts.urgent;
  const total = Math.max(summaries.length, 1);

  const ranked = [...summaries].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  );

  const today = new Date().toISOString().slice(0, 10);
  const callsToday = calls.filter((c) => c.when.slice(0, 10) === today).length;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{greeting()}</h1>
          <p className="sub">
            {plans.length === 0
              ? 'Nothing is waiting for review.'
              : `${plans.length} draft plan${plans.length === 1 ? '' : 's'} awaiting review.`}
          </p>
        </div>
        <div className="spacer" />
        <button className="btn primary" onClick={() => onNavigate('intake')}>
          New intake
        </button>
      </header>

      <div className="grid-dash">
        <Card padded>
          <div
            className="stat-icon"
            style={{
              background: needsAttention > 0 ? 'var(--critical-bg)' : 'var(--ok-bg)',
              color: needsAttention > 0 ? 'var(--critical)' : 'var(--ok)',
            }}
          >
            {Icon.shield()}
          </div>
          <div className="stat-value">{needsAttention}</div>
          <div className="stat-label">
            {needsAttention === 1 ? 'patient needs' : 'patients need'} your attention now
          </div>

          <div className="triage-bar" role="img" aria-label={`${counts.critical} critical, ${counts.urgent} urgent, ${counts.routine} routine`}>
            {counts.critical > 0 && (
              <i className="critical" style={{ width: `${(counts.critical / total) * 100}%` }} />
            )}
            {counts.urgent > 0 && (
              <i className="urgent" style={{ width: `${(counts.urgent / total) * 100}%` }} />
            )}
            {counts.routine > 0 && (
              <i className="routine" style={{ width: `${(counts.routine / total) * 100}%` }} />
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="critical">{counts.critical} critical</Badge>
            <Badge tone="urgent">{counts.urgent} urgent</Badge>
            <Badge tone="routine">{counts.routine} routine</Badge>
          </div>
        </Card>

        <div className="stack">
          <Stat
            icon={Icon.inbox()}
            value={plans.length}
            label="Draft plans"
            sub="in the queue"
            tone="brand"
          />
          <Stat
            icon={Icon.phone()}
            value={callsToday}
            label="Calls today"
            sub={`${calls.length} total`}
            tone="info"
          />
          <Stat
            icon={Icon.users()}
            value={patients.length}
            label="Patients"
            sub="in your workspace"
            tone="ok"
          />
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Card
          title="Needs your attention"
          subtitle="Most urgent first"
          action={
            <button className="link" onClick={() => onNavigate('review')}>
              View all
            </button>
          }
        >
          {ranked.length === 0 ? (
            <Empty>No draft plans are waiting.</Empty>
          ) : (
            ranked.slice(0, 5).map(({ plan, name, priority }) => (
              <button key={plan.id} className="row" onClick={() => onOpenPlan(plan)}>
                <Avatar name={name} />
                <span className="grow">
                  <span className="name">{name}</span>
                  <span className="meta">{plan.title ?? 'Care plan'}</span>
                </span>
                <Badge tone={priority}>{priority}</Badge>
                <span className="chev">{Icon.arrowRight()}</span>
              </button>
            ))
          )}
        </Card>

        <Card
          title="Recent calls"
          action={
            <button className="link" onClick={() => onNavigate('calls')}>
              View all
            </button>
          }
        >
          {calls.length === 0 ? (
            <Empty>No calls recorded yet.</Empty>
          ) : (
            calls.slice(0, 5).map((call) => {
              const name = callNames.get(call.patientReference ?? '') ?? 'Unknown patient';
              return (
                <div key={call.id} className="row" style={{ cursor: 'default' }}>
                  <Avatar name={name} small />
                  <span className="grow">
                    <span className="name">{name}</span>
                    <span className="meta">{call.direction}</span>
                  </span>
                  <Badge tone={call.status === 'Completed' ? 'ok' : 'critical'}>
                    {call.status === 'Completed' && Icon.check()}
                    {call.status}
                  </Badge>
                  <span className="small muted" style={{ marginLeft: 10 }}>
                    {relativeTime(call.when)}
                  </span>
                </div>
              );
            })
          )}
        </Card>
      </div>
    </>
  );
}
