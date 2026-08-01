import { useEffect, useState, type FormEvent } from 'react';
import { createIntake, getModules, startCall, type ModuleSummary } from '../bridge';

/**
 * Creates a patient and starts the outbound check-in call.
 *
 * Dialling a real person is not something to trigger by accident, so the call
 * is a separate, explicit action after intake rather than part of the same
 * submit.
 */
export function IntakeForm(): JSX.Element {
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  const [moduleId, setModuleId] = useState('asthma');
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [payerId, setPayerId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [allergies, setAllergies] = useState('');
  const [triggers, setTriggers] = useState('');

  const [created, setCreated] = useState<{ patientId: string; moduleId: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'warn'; text: string }>();

  useEffect(() => {
    getModules()
      .then((list) => {
        setModules(list);
        if (list[0]) setModuleId(list[0].id);
      })
      .catch(() => setMessage({ kind: 'error', text: 'Could not reach the CareLoop bridge.' }));
  }, []);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await createIntake({
        moduleId,
        givenName,
        familyName,
        birthDate,
        phone,
        ...(payerId && memberId ? { coverage: { payerId, memberId } } : {}),
        allergies: allergies.split(',').map((s) => s.trim()).filter(Boolean),
        triggers: triggers.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setCreated({ patientId: result.patientId, moduleId: result.moduleId });
      setMessage({ kind: 'ok', text: `Patient created: ${result.patientId}` });
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Intake failed.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function dial(): Promise<void> {
    if (!created) return;
    setBusy(true);
    try {
      const result = await startCall(created.patientId, created.moduleId);
      setMessage(
        result.mock
          ? { kind: 'warn', text: 'Twilio is in mock mode — no real call was placed.' }
          : { kind: 'ok', text: `Calling now. Call id ${result.callId}.` },
      );
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Could not start the call.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>New intake</h2>
      {message && <div className={`notice ${message.kind}`}>{message.text}</div>}

      <form onSubmit={submit}>
        <div className="form-row single">
          <div>
            <label htmlFor="module">Condition module</label>
            <select id="module" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
              {modules.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display} — {m.instrument}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="given">First name</label>
            <input id="given" value={givenName} onChange={(e) => setGivenName(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="family">Last name</label>
            <input id="family" value={familyName} onChange={(e) => setFamilyName(e.target.value)} required />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="dob">Date of birth</label>
            <input id="dob" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="phone">Phone (E.164)</label>
            <input id="phone" placeholder="+15555550123" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
        </div>

        <h3>Coverage (optional)</h3>
        <div className="form-row">
          <div>
            <label htmlFor="payer">Payer / trading partner ID</label>
            <input id="payer" value={payerId} onChange={(e) => setPayerId(e.target.value)} />
          </div>
          <div>
            <label htmlFor="member">Member ID</label>
            <input id="member" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
          </div>
        </div>

        <h3>Clinical context (optional)</h3>
        <div className="form-row">
          <div>
            <label htmlFor="allergies">Drug allergies (comma separated)</label>
            <input id="allergies" value={allergies} onChange={(e) => setAllergies(e.target.value)} />
          </div>
          <div>
            <label htmlFor="triggers">Triggers (comma separated)</label>
            <input id="triggers" value={triggers} onChange={(e) => setTriggers(e.target.value)} />
          </div>
        </div>

        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : 'Create patient'}
        </button>
      </form>

      {created && (
        <>
          <h3>Start the check-in call</h3>
          <p className="small muted">
            This dials {phone} and starts the voice check-in. Only do this when the patient is
            expecting the call.
          </p>
          <button onClick={dial} disabled={busy}>Call {givenName || 'patient'} now</button>
        </>
      )}
    </div>
  );
}
