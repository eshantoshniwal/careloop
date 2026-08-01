import { useEffect, useState } from 'react';
import { getModules, type ModuleSummary } from '../bridge';
import { Badge, Card, Empty, Icon } from '../ui';

/**
 * Treatments admin.
 *
 * Read-only for now: the bridge exposes the registry through `GET /modules`,
 * but authoring a condition still means adding a module file. The page states
 * that plainly rather than showing disabled controls that imply otherwise.
 */
export function TreatmentsPage(): JSX.Element {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    getModules()
      .then((list) => {
        setModules(list);
        setSelected(list[0]?.id);
      })
      .catch(() => setError('Could not reach the CareLoop bridge.'));
  }, []);

  const active = modules.find((m) => m.id === selected);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Treatments</h1>
          <p className="sub">
            The condition modules the engine can run. Adding one requires no engine changes.
          </p>
        </div>
      </header>

      {error && <div className="notice error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="grid-review">
        <Card title="Modules" subtitle={`${modules.length} registered`}>
          {modules.length === 0 && !error ? (
            <Empty>Loading…</Empty>
          ) : (
            modules.map((module) => (
              <button
                key={module.id}
                className={`row ${module.id === selected ? 'selected' : ''}`}
                onClick={() => setSelected(module.id)}
              >
                <span className="grow">
                  <span className="name">{module.display}</span>
                  <span className="meta">{module.instrument}</span>
                </span>
                <span className="chev">{Icon.chevron()}</span>
              </button>
            ))
          )}
        </Card>

        {active && (
          <div className="stack">
            <Card padded>
              <h2 style={{ fontSize: 19 }}>{active.display}</h2>
              <p className="small muted" style={{ marginTop: 4 }}>{active.instrument}</p>

              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                <Badge tone="brand">{active.items} instrument items</Badge>
                {typeof active.riskQuestions === 'number' && (
                  <Badge tone="info">{active.riskQuestions} risk questions</Badge>
                )}
                {active.icd10 && <Badge tone="routine">ICD-10 {active.icd10}</Badge>}
              </div>
            </Card>

            <Card title="What a module owns" padded>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                <li>The instrument, its LOINC codes, and the scoring bands</li>
                <li>Protocol steps: RxNorm-coded orders, follow-up interval, escalation flags</li>
                <li>Future-risk questions and the rules that read them</li>
                <li>Emergency rules, which take precedence over the whole call flow</li>
                <li>Expert personas for the review panel</li>
                <li>A patient-safe knowledge corpus for retrieval</li>
              </ul>
              <p className="small muted" style={{ marginTop: 16 }}>
                Modules are authored as files under <span className="mono">src/conditions/</span> and
                registered in <span className="mono">registry.ts</span>. The registry also hydrates
                stored modules from FHIR PlanDefinitions at startup, with built-ins overlaid last so
                a broken stored definition cannot shadow a known-good one.
              </p>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
