import type { CarePlan } from '@medplum/fhirtypes';
import { useCallback, useEffect, useState } from 'react';
import { getHealth, type BridgeHealth } from './bridge';
import { IntakeForm } from './components/IntakeForm';
import { PlanDetail } from './components/PlanDetail';
import { SignIn } from './components/SignIn';
import { fetchDraftPlans } from './data';
import { medplum, signOut } from './medplum';

type Tab = 'review' | 'intake';

function MockBanner({ health }: { health?: BridgeHealth }): JSX.Element | null {
  if (!health) return null;
  const mocked = Object.entries(health.live)
    .filter(([, enabled]) => !enabled)
    .map(([name]) => name);
  if (mocked.length === 0) return null;
  return (
    <div className="notice warn">
      <strong>Mock mode:</strong> {mocked.join(', ')} {mocked.length === 1 ? 'is' : 'are'} not
      configured. Results from {mocked.length === 1 ? 'it' : 'them'} are deterministic test data,
      not real.
    </div>
  );
}

function ReviewQueue({
  plans,
  selectedId,
  onSelect,
}: {
  plans: CarePlan[];
  selectedId?: string;
  onSelect: (plan: CarePlan) => void;
}): JSX.Element {
  return (
    <div className="panel">
      <h2>Review queue ({plans.length})</h2>
      {plans.length === 0 && (
        <p className="small muted">No draft plans are waiting for review.</p>
      )}
      {plans.map((plan) => (
        <button
          key={plan.id}
          className={`queue-item ${plan.id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(plan)}
        >
          <div className="title">{plan.title ?? 'Care plan'}</div>
          <div className="small muted">
            {plan.created?.slice(0, 10) ?? 'undated'} · {plan.subject?.reference}
          </div>
        </button>
      ))}
    </div>
  );
}

export function App(): JSX.Element {
  const [authenticated, setAuthenticated] = useState(medplum.isAuthenticated());
  const [tab, setTab] = useState<Tab>('review');
  const [plans, setPlans] = useState<CarePlan[]>([]);
  const [selected, setSelected] = useState<CarePlan>();
  const [health, setHealth] = useState<BridgeHealth>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const drafts = await fetchDraftPlans();
      setPlans(drafts);
      setSelected((current) => drafts.find((p) => p.id === current?.id) ?? drafts[0]);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load draft plans.');
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void reload();
    getHealth().then(setHealth).catch(() => undefined);
  }, [authenticated, reload]);

  if (!authenticated) {
    return <SignIn onSignedIn={() => setAuthenticated(true)} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>CareLoop</h1>
        <div className="tabs">
          <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
            Review
          </button>
          <button className={tab === 'intake' ? 'active' : ''} onClick={() => setTab('intake')}>
            Intake
          </button>
        </div>
        <div className="spacer" />
        {tab === 'review' && <button onClick={() => void reload()}>Refresh</button>}
        <button
          onClick={() => {
            signOut();
            setAuthenticated(false);
          }}
        >
          Sign out
        </button>
      </header>

      <MockBanner health={health} />
      {error && <div className="notice error">{error}</div>}

      {tab === 'intake' ? (
        <IntakeForm />
      ) : (
        <div className="grid">
          <ReviewQueue plans={plans} selectedId={selected?.id} onSelect={setSelected} />
          {selected ? (
            <PlanDetail plan={selected} onApproved={() => void reload()} />
          ) : (
            <div className="panel">
              <p className="small muted">Select a draft plan to review it.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
