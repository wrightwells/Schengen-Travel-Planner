import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import type { Traveller, TripDraft } from './api';

type Entry = { key: string; title: string; rows: number[]; state: string; message: string;
  allowed_actions: string[]; trip: TripDraft | null; existing_trip?: TripDraft };
type Preview = { preview_token: string; row_count: number; traveller_names: string[];
  mapping: Record<string, string | null>; entries: Entry[] };

export function ImportPanel({ travellers, csrf, revision, onChanged, onExpired }: {
  travellers: Traveller[]; csrf: string; revision: number; onChanged: () => void; onExpired: () => void;
}) {
  const [content, setContent] = useState('');
  const [filename, setFilename] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [names, setNames] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { setPreview(null); }, [revision]);
  function failed(error: unknown) {
    if (error instanceof ApiError && error.status === 401) onExpired();
    setError(error instanceof Error ? error.message : 'Could not import CSV. Please retry.');
  }
  async function load(file?: File) {
    setPreview(null); setContent(''); setMapping({}); setNames([]); setMessage(''); setError('');
    setFilename(file?.name || '');
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 512_000) throw new Error('Choose a CSV file of at most 512 KB.');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      setContent(text);
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }
  async function prepare() {
    setBusy(true); setError(''); setMessage(''); setPreview(null);
    try {
      const result = await api<Preview>('/imports/history/preview', {
        method: 'POST', body: JSON.stringify({ content, traveller_mapping: mapping }),
      }, csrf);
      setNames(result.traveller_names);
      setPreview(result);
      setDecisions(Object.fromEntries(result.entries.map(e => [e.key, e.state === 'ready' ? 'import' : 'skip'])));
    } catch (error) { failed(error); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api<{ imported_count: number; skipped_count: number }>('/imports/history/commit', {
        method: 'POST', body: JSON.stringify({ content, traveller_mapping: mapping,
          preview_token: preview.preview_token, decisions }),
      }, csrf);
      setPreview(null);
      setMessage(`Imported ${result.imported_count} trip${result.imported_count === 1 ? '' : 's'}; skipped ${result.skipped_count}. Review history completeness for the affected travellers.`);
      onChanged();
    } catch (error) {
      failed(error);
      if (error instanceof ApiError && error.status === 409) setPreview(null);
    } finally { setBusy(false); }
  }
  const selected = Object.values(decisions).filter(a => a !== 'skip').length;
  function itinerary(trip: TripDraft) {
    return <><h4>{trip.title}</h4><ul>{trip.participants.map(p => <li key={p.traveller_id}>
      {travellers.find(t => t.id === p.traveller_id)?.display_name}: {p.entry_date} → {p.exit_date}
      <ul>{p.segments.map((s, i) => <li key={i}>{s.country_code}: {s.start_date} → {s.end_date}</li>)}</ul>
    </li>)}</ul></>;
  }
  return <section className="workspace-section import-panel" aria-labelledby="imports-heading">
    <span className="eyebrow">BRING YOUR HISTORY TOGETHER</span><h2 id="imports-heading">Import travel history</h2>
    <p>Choose a UTF-8 history CSV using the export schema, map traveller names, then review each trip before saving. Dates must use YYYY-MM-DD. Calendar files and planned trips cannot be imported.</p>
    <label>History CSV file<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => void load(e.target.files?.[0])} /></label>
    {filename && <p className="field-note export-filename">{filename}</p>}
    {names.length > 0 && <fieldset disabled={busy}><legend>Traveller mapping</legend>
      {names.map(name => <label key={name}>CSV traveller: {name}<select value={mapping[name] || ''} onChange={e => {
        setMapping(current => { const next = { ...current }; if (e.target.value) next[name] = e.target.value; else delete next[name]; return next; });
        setPreview(null); setMessage('');
      }}><option value="">Match current name automatically</option>
        {travellers.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}
      </select></label>)}
    </fieldset>}
    <button disabled={busy || !content || !travellers.length} onClick={() => void prepare()}>{busy ? 'Working…' : 'Preview import'}</button>
    {busy && <p role="status">Checking and preparing your import…</p>}
    {error && <p role="alert" className="error">{error} No partial import was saved. Preview again to retry.</p>}
    {message && <p role="status" className="notice">{message}</p>}
    {preview && <div className="card import-preview" aria-label="Import preview">
      <h3>Review history import</h3><p role="status">{preview.row_count} segment rows across {preview.entries.length} trips.</p>
      {!preview.entries.length && <p>This CSV has no trips to import.</p>}
      <p className="field-note">Nothing is saved until you commit. Skip keeps stored history unchanged. Replace rewrites the entire existing trip, including all its dates and destinations. History completeness must be reviewed after changes.</p>
      <ul className="import-entries">{preview.entries.map(entry => <li key={entry.key}>
        <h4>{entry.title || 'Untitled trip'} · {entry.state}</h4>
        <p>CSV rows {entry.rows.join(', ')}. {entry.message}</p>
        {entry.trip && <details><summary>Incoming itinerary</summary>{itinerary(entry.trip)}</details>}
        {entry.existing_trip && <details><summary>Existing itinerary to replace</summary>{itinerary(entry.existing_trip)}</details>}
        <label>Action for {entry.title || entry.key}<select disabled={busy} value={decisions[entry.key] || 'skip'} onChange={e => setDecisions(d => ({ ...d, [entry.key]: e.target.value }))}>
          {entry.allowed_actions.map(action => <option key={action} value={action}>{action === 'skip' ? 'Skip trip' : action === 'replace' ? 'Replace entire stored trip' : 'Import new history'}</option>)}
        </select></label>
      </li>)}</ul>
      <button disabled={busy || !selected} onClick={() => void commit()}>Commit {selected} selected trip{selected === 1 ? '' : 's'}</button>
      <p className="field-note">The whole selected batch is checked and saved together. If any selected trip fails, the entire batch is rolled back. Previews expire after 15 minutes; changes in another window require a fresh preview.</p>
    </div>}
  </section>;
}
