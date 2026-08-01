import type { CarePlan } from '@medplum/fhirtypes';
import { useEffect, useState } from 'react';
import { getHealth, type BridgeHealth } from './bridge';
import { CallsPage } from './pages/Calls';
import { DashboardPage } from './pages/Dashboard';
import { IntakePage } from './pages/Intake';
import { LivePage } from './pages/Live';
import { PatientsPage } from './pages/Patients';
import { ReviewPage } from './pages/Review';
import { TreatmentsPage } from './pages/Treatments';
import { SignIn } from './components/SignIn';
import { useDraftPlans, useLiveFeed, usePatients } from './data';
import { medplum, signOut } from './medplum';
import { Avatar, Icon } from './ui';

export type Route =
  | 'dashboard'
  | 'live'
  | 'review'
  | 'calls'
  | 'patients'
  | 'intake'
  | 'treatments';

const NAV: Array<{ route: Route; label: string; icon: () => JSX.Element }> = [
  { route: 'dashboard', label: 'Dashboard', icon: Icon.home },
  { route: 'live', label: 'Live', icon: Icon.live },
  { route: 'review', label: 'Review queue', icon: Icon.list },
  { route: 'calls', label: 'Calls', icon: Icon.phone },
  { route: 'patients', label: 'Patients', icon: Icon.users },
  { route: 'intake', label: 'New intake', icon: Icon.plus },
  { route: 'treatments', label: 'Treatments', icon: Icon.clipboard },
];

function MockBanner({ health }: { health?: BridgeHealth }): JSX.Element | null {
  if (!health) return null;
  const mocked = Object.entries(health.live)
    .filter(([, enabled]) => !enabled)
    .map(([name]) => name);
  if (mocked.length === 0) return null;
  return (
    <div className="notice warn" style={{ marginBottom: 20 }}>
      <strong>Mock mode:</strong> {mocked.join(', ')} {mocked.length === 1 ? 'is' : 'are'} not
      configured. Results from {mocked.length === 1 ? 'it' : 'them'} are deterministic test data,
      not real.
    </div>
  );
}

export function App(): JSX.Element {
  const [authenticated, setAuthenticated] = useState(medplum.isAuthenticated());
  const [route, setRoute] = useState<Route>('dashboard');
  const [selectedPlan, setSelectedPlan] = useState<CarePlan>();
  const [livePatientId, setLivePatientId] = useState<string>();
  const [health, setHealth] = useState<BridgeHealth>();

  const { plans, refresh } = useDraftPlans();
  const { patients } = usePatients();

  // Drives the red dot on the Live nav item: something is being charted now.
  const mostRecentPatientId = livePatientId ?? patients[0]?.id;
  const { live } = useLiveFeed(route === 'live' ? undefined : mostRecentPatientId, 8000);

  useEffect(() => {
    if (!authenticated) return;
    getHealth().then(setHealth).catch(() => undefined);
  }, [authenticated]);

  if (!authenticated) {
    return <SignIn onSignedIn={() => setAuthenticated(true)} />;
  }

  const profile = medplum.getProfile();
  const profileName =
    profile?.name?.[0]
      ? [profile.name[0].given?.join(' '), profile.name[0].family].filter(Boolean).join(' ')
      : 'Clinician';
  const profileEmail = medplum.getActiveLogin()?.profile?.display ?? '';

  function openPlan(plan: CarePlan): void {
    setSelectedPlan(plan);
    setRoute('review');
  }

  function openLive(patientId: string): void {
    setLivePatientId(patientId);
    setRoute('live');
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">{Icon.pulse({ ...iconProps, width: 19, height: 19 })}</span>
          <span className="brand-name">CareLoop</span>
        </div>

        <p className="nav-label">Workspace</p>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.route}
              className={route === item.route ? 'active' : ''}
              onClick={() => setRoute(item.route)}
              aria-current={route === item.route ? 'page' : undefined}
            >
              {item.icon()}
              {item.label}
              {item.route === 'live' && live && <span className="dot" aria-label="charting now" />}
              {item.route === 'review' && plans.length > 0 && (
                <span className="count">{plans.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <Avatar name={profileName} small />
          <span className="who">
            <strong>{profileName}</strong>
            <span>{profileEmail}</span>
          </span>
          <button
            className="icon-btn"
            title="Sign out"
            onClick={() => {
              signOut();
              setAuthenticated(false);
            }}
          >
            {Icon.logout()}
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-narrow">
          <MockBanner health={health} />

          {route === 'dashboard' && (
            <DashboardPage
              plans={plans}
              patients={patients}
              onOpenPlan={openPlan}
              onNavigate={setRoute}
            />
          )}
          {route === 'live' && (
            <LivePage
              patients={patients}
              patientId={livePatientId}
              onSelect={setLivePatientId}
            />
          )}
          {route === 'review' && (
            <ReviewPage
              plans={plans}
              selected={selectedPlan}
              onSelect={setSelectedPlan}
              onChanged={refresh}
            />
          )}
          {route === 'calls' && <CallsPage onOpenLive={openLive} />}
          {route === 'patients' && <PatientsPage patients={patients} onOpenLive={openLive} />}
          {route === 'intake' && <IntakePage onCallStarted={openLive} />}
          {route === 'treatments' && <TreatmentsPage />}
        </div>
      </main>
    </div>
  );
}

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.1,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};
