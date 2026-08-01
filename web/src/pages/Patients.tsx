import type { Patient } from '@medplum/fhirtypes';
import { useState } from 'react';
import { startCall } from '../bridge';
import { displayName } from '../data';
import { Avatar, Badge, Card, Empty, Icon, relativeTime } from '../ui';

export function PatientsPage({
  patients,
  onOpenLive,
}: {
  patients: Patient[];
  onOpenLive: (patientId: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [dialing, setDialing] = useState<string>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string }>();

  const filtered = patients.filter((p) =>
    displayName(p).toLowerCase().includes(query.trim().toLowerCase()),
  );

  /**
   * Dialling reaches a real person, so it is a deliberate per-row action with
   * a confirmation rather than something that can happen from a stray click.
   */
  async function dial(patient: Patient): Promise<void> {
    const name = displayName(patient);
    const phone = patient.telecom?.find((t) => t.system === 'phone')?.value;
    if (!patient.id || !phone) {
      setMessage({ kind: 'error', text: `${name} has no phone number on file.` });
      return;
    }
    if (!window.confirm(`Call ${name} on ${phone} now?`)) return;

    setDialing(patient.id);
    setMessage(undefined);
    try {
      const result = await startCall(patient.id);
      setMessage(
        result.mock
          ? { kind: 'warn', text: 'Twilio is in mock mode — no real call was placed.' }
          : { kind: 'ok', text: `Calling ${name} now.` },
      );
      if (!result.mock) onOpenLive(patient.id);
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not start the call.',
      });
    } finally {
      setDialing(undefined);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Patients</h1>
          <p className="sub">{patients.length} in your workspace.</p>
        </div>
        <div className="spacer" />
        <div style={{ width: 260 }}>
          <input
            placeholder="Search by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search patients"
          />
        </div>
      </header>

      {message && (
        <div className={`notice ${message.kind}`} style={{ marginBottom: 16 }}>
          {message.text}
        </div>
      )}

      <Card title="Directory">
        {filtered.length === 0 ? (
          <Empty>{query ? 'No patients match that search.' : 'No patients yet.'}</Empty>
        ) : (
          filtered.map((patient) => {
            const name = displayName(patient);
            const phone = patient.telecom?.find((t) => t.system === 'phone')?.value;
            return (
              <div key={patient.id} className="row" style={{ cursor: 'default' }}>
                <Avatar name={name} />
                <span className="grow">
                  <span className="name">{name}</span>
                  <span className="meta">
                    {patient.birthDate ? `DOB ${patient.birthDate}` : 'No DOB'}
                    {phone ? ` · ${phone}` : ' · no phone'}
                  </span>
                </span>
                {patient.meta?.lastUpdated && (
                  <span className="small muted">{relativeTime(patient.meta.lastUpdated)}</span>
                )}
                {!phone && <Badge tone="routine">no phone</Badge>}
                <button
                  className="btn"
                  disabled={!phone || dialing === patient.id}
                  onClick={() => void dial(patient)}
                >
                  {Icon.phone()} {dialing === patient.id ? 'Calling…' : 'Call'}
                </button>
                <button
                  className="btn"
                  onClick={() => patient.id && onOpenLive(patient.id)}
                >
                  Live
                </button>
              </div>
            );
          })
        )}
      </Card>
    </>
  );
}
