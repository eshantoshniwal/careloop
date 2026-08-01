import type { CarePlan } from '@medplum/fhirtypes';
import { useEffect, useState } from 'react';
import { getHealth, type BridgeHealth } from './bridge';
import { SignIn } from './components/SignIn';
import { useDraftPlans, useLiveFeed, usePatients } from './data';
import { CallsPage } from './pages/Calls';
import { DashboardPage } from './pages/Dashboard';
import { IntakePage } from './pages/Intake';
import { LivePage } from './pages/Live';
import { PatientPage } from './pages/Patient';
import { PatientsPage } from './pages/Patients';
import { ReviewPage } from './pages/Review';
import { TreatmentsPage } from './pages/Treatments';
import { medplum, signOut } from './medplum';
import { Avatar, Icon, applyTheme, readTheme, resolvedTheme, type Theme } from './ui';

export type Route = 'dashboard' | 'live' | 'review' | 'calls' | 'patients' | 'intake' | 'treatments' | 'patient';

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
  const [detailPatientId, setDetailPatientId] = useState<string>();
  const [health, setHealth] = useState<BridgeHealth>();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [navOpen, setNavOpen] = useState(false);

  const { plans, loading, refresh } = useDraftPlans();
  const { patients } = usePatients();

  // Drives the red dot on Live: something is being charted right now.
  const watched = livePatientId ?? patients[0]?.id;
  const { live } = useLiveFeed(route === 'live' ? undefined : watched, 8000);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (!authenticated) return;
    getHealth().then(setHealth).catch(() => undefined);
  }, [authenticated]);

  if (!authenticated) {
    return <SignIn onSignedIn={() => setAuthenticated(true)} />;
  }

  const profile = medplum.getProfile();
  const profileName = profile?.name?.[0]
    ? [profile.name[0].given?.join(' '), profile.name[0].family].filter(Boolean).join(' ')
    : 'Clinician';
  const profileEmail = medplum.getActiveLogin()?.profile?.display ?? '';

  function go(next: Route): void {
    setRoute(next);
    setNavOpen(false);
  }

  function openPlan(plan: CarePlan): void {
    setSelectedPlan(plan);
    go('review');
  }

  function openLive(patientId: string): void {
    setLivePatientId(patientId);
    go('live');
  }

  function openPatient(patientId: string): void {
    setDetailPatientId(patientId);
    go('patient');
  }

  const isDark = resolvedTheme(theme) === 'dark';

  return (
    <div className="shell">
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">
            <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l3 8 4-16 3 8h4" />
            </svg>
          </span>
          <span className="brand-name">CareLoop</span>
        </div>

        <p className="nav-label">Workspace</p>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.route}
              className={route === item.route ? 'active' : ''}
              onClick={() => go(item.route)}
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

        <div className="sync" title="The workspace refreshes on its own — no reload needed">
          <i /> Live · auto-syncing
        </div>

        <div className="sidebar-foot">
          <Avatar name={profileName} small />
          <span className="who">
            <strong>{profileName}</strong>
            <span>{profileEmail}</span>
          </span>
          <button
            className="icon-btn"
            title={isDark ? 'Switch to light' : 'Switch to dark'}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
          >
            {isDark ? Icon.sun() : Icon.moon()}
          </button>
          <button
            className="icon-btn"
            title="Sign out"
            aria-label="Sign out"
            onClick={() => { signOut(); setAuthenticated(false); }}
          >
            {Icon.logout()}
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-narrow">
          <button
            className="icon-btn menu-btn"
            aria-label="Open navigation"
            onClick={() => setNavOpen((open) => !open)}
            style={{ marginBottom: 12 }}
          >
            {Icon.menu()}
          </button>

          <MockBanner health={health} />

          {route === 'dashboard' && (
            <DashboardPage
              plans={plans}
              loading={loading}
              patients={patients}
              onOpenPlan={openPlan}
              onOpenPatient={openPatient}
              onNavigate={go}
            />
          )}
          {route === 'live' && (
            <LivePage patients={patients} patientId={livePatientId} onSelect={setLivePatientId} />
          )}
          {route === 'review' && (
            <ReviewPage
              plans={plans}
              loading={loading}
              selected={selectedPlan}
              onSelect={setSelectedPlan}
              onChanged={refresh}
              onOpenLive={openLive}
            />
          )}
          {route === 'calls' && <CallsPage onOpenPatient={openPatient} />}
          {route === 'patients' && (
            <PatientsPage patients={patients} onOpenLive={openLive} onOpenPatient={openPatient} />
          )}
          {route === 'patient' && detailPatientId && (
            <PatientPage
              patientId={detailPatientId}
              patients={patients}
              onOpenPlan={openPlan}
              onOpenLive={openLive}
              onBack={() => go('patients')}
            />
          )}
          {route === 'intake' && <IntakePage onCallStarted={openLive} />}
          {route === 'treatments' && <TreatmentsPage />}
        </div>
      </main>
    </div>
  );
}
