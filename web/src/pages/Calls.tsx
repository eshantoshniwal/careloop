import { useCalls, usePatientNames, idFromReference } from '../data';
import { Avatar, Badge, Card, Empty, Icon, relativeTime } from '../ui';

export function CallsPage({ onOpenLive }: { onOpenLive: (patientId: string) => void }): JSX.Element {
  const calls = useCalls();
  const names = usePatientNames(calls.map((c) => c.patientReference));

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Calls</h1>
          <p className="sub">Every check-in call, most recent first.</p>
        </div>
      </header>

      <Card title="Call log" subtitle={`${calls.length} recorded`}>
        {calls.length === 0 ? (
          <Empty>
            No calls recorded yet. The log is written when a call completes.
          </Empty>
        ) : (
          calls.map((call) => {
            const name = names.get(call.patientReference ?? '') ?? 'Unknown patient';
            const patientId = idFromReference(call.patientReference);
            return (
              <button
                key={call.id}
                className="row"
                onClick={() => patientId && onOpenLive(patientId)}
              >
                <Avatar name={name} small />
                <span className="grow">
                  <span className="name">{name}</span>
                  <span className="meta">{call.direction}</span>
                </span>
                <Badge tone={call.status === 'Completed' ? 'ok' : 'critical'}>
                  {call.status === 'Completed' && Icon.check()}
                  {call.status}
                </Badge>
                <span className="small muted" style={{ marginLeft: 10, minWidth: 72, textAlign: 'right' }}>
                  {relativeTime(call.when)}
                </span>
                <span className="chev">{Icon.chevron()}</span>
              </button>
            );
          })
        )}
      </Card>
    </>
  );
}
