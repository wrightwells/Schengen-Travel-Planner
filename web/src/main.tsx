import { StrictMode, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError } from './api';
import { useLocalDate } from './useLocalDate';
import type { Traveller, PersonSummary, Summary } from './api';
import { TravelWorkspace } from './TravelWorkspace';
import { ExportPanel } from './ExportPanel';
import { ImportPanel } from './ImportPanel';
import './style.css';

type Session = { username: string; csrf_token: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Please retry.';

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      onLogin(await api<Session>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: data.get('username'), password: data.get('password') }),
      }));
    } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }
  return <section className="card login" aria-labelledby="login-title">
    <span className="eyebrow">YOUR HOUSEHOLD, YOUR JOURNEYS</span>
    <h2 id="login-title">Welcome back.</h2>
    <p>Sign in to your private travel planner.</p>
    <form onSubmit={submit}>
      <label>Username<input name="username" autoComplete="username" required maxLength={100} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024} /></label>
      {error && <p role="alert" className="error">{error}</p>}
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </section>;
}

function Profile({ traveller, csrf, onSave, onExpired, summary, referenceDate }: {
  traveller: Traveller; csrf: string; onSave: (saved: Traveller) => void; onExpired: () => void;
  summary?: PersonSummary; referenceDate: string;
}) {
  const [name, setName] = useState(traveller.display_name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { setName(traveller.display_name); }, [traveller.display_name]);
  async function save(event: FormEvent) {
    event.preventDefault();
    await persist(name.trim(), traveller.history_complete, 'Name saved.');
  }
  async function persist(displayName: string, complete: boolean, success: string) {
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const saved = await api<Traveller>(`/travellers/${traveller.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          display_name: displayName, rule_applicable: traveller.rule_applicable,
          history_complete: complete, notes: traveller.notes, version: traveller.version,
        }),
      }, csrf);
      onSave(saved); setMessage(success);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      setFailed(true); setMessage(errorText(error));
    } finally { setBusy(false); }
  }
  return <article className="card profile">
    <div className="profile-heading"><span className="avatar" aria-hidden="true">{traveller.display_name[0]}</span>
      <div><h3>{traveller.display_name}</h3><span className="badge">{traveller.rule_applicable === true
        ? 'Standard 90/180 rule' : traveller.rule_applicable === false
          ? 'Not assessed — check immigration status' : 'Rule applicability unconfirmed'}</span></div></div>
    <div className="allowance-summary"><div><span>Recorded Schengen days</span><strong>{summary?.used_days ?? '—'}<small> / 90</small></strong></div>
      <div><span>Remaining days</span><strong>{traveller.history_complete && traveller.rule_applicable === true ? summary?.remaining_days ?? '—' : '—'}</strong></div></div>
    <p className="field-note">As of {referenceDate} · confirmed history only</p>
    <p className={`notice ${summary?.status === 'OVER_LIMIT' ? 'over-limit-notice' : ''}`}>{traveller.rule_applicable === false
      ? 'Not assessed — check immigration status' : summary?.status === 'OVER_LIMIT'
      ? 'Over limit in this rolling window' : summary?.status === 'APPROACHING_LIMIT' ? 'Approaching the rolling limit'
        : traveller.history_complete ? 'History reviewed' : 'Unknown — history not yet confirmed'}
      <span>{traveller.history_complete ? 'Recheck completeness whenever you add or correct a trip.' : 'Recorded usage may be incomplete. Review your history before relying on an allowance.'}</span></p>
    <form onSubmit={save}>
      <label htmlFor={`name-${traveller.id}`}>Display name</label>
      <div className="save-row"><input id={`name-${traveller.id}`} value={name}
        onChange={event => setName(event.target.value)} maxLength={100} required />
        <button disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save name'}</button></div>
      <p role={failed ? 'alert' : 'status'} className={failed ? 'error feedback' : 'feedback'}>{message}</p>
    </form>
    <button className="secondary review-button" disabled={busy} onClick={() => {
      if (!traveller.history_complete && !window.confirm('Confirm that all past Schengen travel relevant to your reference date and planned stays has been recorded, including periods with no travel.')) return;
      void persist(traveller.display_name, !traveller.history_complete, 'History review saved.');
    }}>{traveller.history_complete ? 'Mark history incomplete' : 'Confirm history complete'}</button>
  </article>;
}

function Household({ session, onExpired }: { session: Session; onExpired: () => void }) {
  const [travellers, setTravellers] = useState<Traveller[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const referenceDate = useLocalDate();
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([api<Traveller[]>('/travellers'), api<Summary>(`/eligibility/summary?reference_date=${referenceDate}`)])
      .then(([data, totals]) => { if (active) { setTravellers(data); setSummary(totals); } })
      .catch(error => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) onExpired();
        setError(errorText(error));
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload, referenceDate]);
  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }, session.csrf_token); onExpired(); }
    catch (error) { setError(errorText(error)); }
  }
  return <>
    <div className="section-heading"><div><span className="eyebrow">HOUSEHOLD PROFILES</span>
      <h2>Two travellers. Individual allowances.</h2></div><div className="actions"><a className="text-button" href="#exports-heading">Export travel</a><a className="text-button" href="#imports-heading">Import history</a><button className="secondary" onClick={logout}>Sign out</button></div></div>
    <p className="intro">Your travel records and rolling allowances stay separate, even when you travel together.</p>
    <p className="field-note">Allowances use today’s date and confirmed history. Saved plans are assessed in the calendar and planner.</p>
    {error && <div role="alert"><p className="error">{error}</p><button onClick={() => setReload(reload + 1)}>Retry</button></div>}
    {loading && <p role="status">Loading your household…</p>}
    <div className="profiles">{travellers.map(traveller => <Profile key={traveller.id} traveller={traveller}
      csrf={session.csrf_token} onExpired={onExpired} referenceDate={summary?.reference_date || referenceDate}
      summary={summary?.travellers.find(person => person.traveller_id === traveller.id)}
      onSave={saved => { setTravellers(items => items.map(item => item.id === saved.id ? saved : item)); setReload(value => value + 1); }} />)}</div>
    <TravelWorkspace travellers={travellers} csrf={session.csrf_token} referenceDate={referenceDate}
      revision={reload} onChanged={affected => {
        if (affected?.length) {
          setTravellers(items => items.map(item => affected.includes(item.id)
            ? { ...item, history_complete: false, history_reviewed_on: null, version: item.version + 1 } : item));
          setSummary(null);
        }
        setReload(value => value + 1);
      }} onExpired={onExpired} />
    <ExportPanel travellers={travellers} revision={reload} onExpired={onExpired} />
    <ImportPanel travellers={travellers} csrf={session.csrf_token} revision={reload}
      onChanged={() => setReload(value => value + 1)} onExpired={onExpired} />
  </>;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setChecking(true); setError('');
    api<Session>('/auth/session').then(data => { if (active) setSession(data); })
      .catch(error => {
        if (active && !(error instanceof ApiError && error.status === 401)) setError(errorText(error));
      }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [reload]);
  return <div className="shell"><header><a href="/" className="brand"><span aria-hidden="true" className="brand-mark">S</span>
    <span>Schengen<span className="brand-subtitle">TRAVEL PLANNER</span></span></a><span className="private-label">Private household workspace</span></header>
    <main>{checking ? <p role="status">Opening your planner…</p> : error ? <section className="card" role="alert">
      <h2>Cannot reach your planner</h2><p>{error}</p><button onClick={() => setReload(reload + 1)}>Retry connection</button>
    </section> : session ? <Household session={session} onExpired={() => setSession(null)} /> : <Login onLogin={setSession} />}</main>
    <footer><p>A planning aid for the standard 90 days in any rolling 180-day period.
      Your immigration status may change which rules apply.</p><span>Development version 0.4.0 · catalogue 2026-10-28</span></footer></div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
