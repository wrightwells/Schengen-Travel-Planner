import { useEffect, useState } from 'react';
import { api, ApiError, localDate } from './api';
import type { Traveller } from './api';

type ExportType = 'history.csv' | 'history.ics' | 'plans.ics';
type ExportPreview = {
  filename: string; media_type: string; content: string; row_count: number; trip_count: number;
  rows: { trip_external_id: string; traveller_name: string; trip_title: string;
    country_name: string; country_code: string; segment_start: string; segment_end: string; trip_status: string }[];
};

export function ExportPanel({ travellers, revision, onExpired }: {
  travellers: Traveller[]; revision: number; onExpired: () => void;
}) {
  const [kind, setKind] = useState<ExportType>('history.csv');
  const [person, setPerson] = useState('');
  const [requested, setRequested] = useState(0);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [download, setDownload] = useState<{ snapshot: ExportPreview; url: string } | null>(null);
  const today = localDate();
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null); setError(''); setBusy(false);
    if (!requested) return;
    setBusy(true);
    const query = new URLSearchParams({ preview: 'true', export_date: today });
    if (person) query.set('traveller_id', person);
    api<ExportPreview>(`/exports/${kind}?${query}`, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setPreview(data);
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onExpired();
      setError(error instanceof Error ? error.message : 'Could not prepare export. Please retry.');
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [kind, person, requested, revision, today]);
  useEffect(() => {
    setDownload(null);
    if (!preview) return;
    const url = URL.createObjectURL(new Blob([preview.content], { type: `${preview.media_type};charset=utf-8` }));
    setDownload({ snapshot: preview, url });
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  return <section className="workspace-section export-panel" aria-labelledby="exports-heading">
    <span className="eyebrow">TAKE YOUR TRAVEL WITH YOU</span><h2 id="exports-heading">Export travel</h2>
    <p>Download recorded history as CSV, or add history and saved plans to your calendar using separate .ics files. Choose who to include and preview before downloading.</p>
    <div className="export-controls"><label>Export format<select value={kind} onChange={e => { setRequested(0); setPreview(null); setKind(e.target.value as ExportType); }}>
      <option value="history.csv">History CSV (.csv)</option><option value="history.ics">History calendar (.ics)</option>
      <option value="plans.ics">Planned trips calendar (.ics)</option>
    </select></label><label>Export traveller<select value={person} onChange={e => { setRequested(0); setPreview(null); setPerson(e.target.value); }}>
      <option value="">Both travellers</option>{travellers.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}
    </select></label></div>
    <p className="field-note">{kind === 'plans.ics'
      ? 'Includes all saved plans for the selected travellers, including alternatives excluded from the calendar scenario. Plans are labelled provisional; this export does not assess compliance.'
      : 'Includes confirmed history only. Both entry and exit dates are included.'}
      {' '}All recorded dates are included; dashboard filters do not apply.
      {' '}{kind.endsWith('.ics') ? 'Calendar exports are one-way snapshots. They do not sync changes or remove previously imported events.'
        : 'CSV contains one row per country segment, with UTF-8 names and ISO dates. Formula-like names and titles receive a leading apostrophe for spreadsheet safety.'}</p>
    <button disabled={busy || !travellers.length} onClick={() => setRequested(n => n + 1)}>{busy ? 'Preparing export…' : 'Preview export'}</button>
    {busy && <p role="status" className="field-note">Preparing your export preview…</p>}
    {error && <p role="alert" className="error">{error} Choose Preview export to retry.</p>}
    {preview && <div className="card export-preview" aria-label="Export preview">
      <h3>{kind === 'plans.ics' ? 'Planned trips' : 'Confirmed history'} · {person ? travellers.find(t => t.id === person)?.display_name : 'Both travellers'}</h3>
      <p role="status">{preview.row_count} {kind.endsWith('.csv') ? 'segment row' : 'calendar event'}{preview.row_count === 1 ? '' : 's'} across {preview.trip_count} trip{preview.trip_count === 1 ? '' : 's'}.</p>
      {!preview.row_count ? <p>No matching trips to export. Choose another traveller or export type.</p> : <>
        <p className="field-note">Dates below are inclusive. {preview.row_count > preview.rows.length && `Showing the first ${preview.rows.length} entries; the download includes all ${preview.row_count}. `}The download contains this previewed snapshot. Choose Preview export again to refresh it.</p>
        <ul className="export-rows">{preview.rows.map((row, i) => <li key={i}>
          <div><h4>{row.trip_title}</h4><span>{row.traveller_name}</span></div>
          <span>{row.country_name} ({row.country_code})</span>
          <span>{row.segment_start} → {row.segment_end}</span>
          <span className={`trip-kind ${row.trip_status.toLowerCase()}`}>{row.trip_status === 'HISTORY' ? 'Confirmed history' : 'Provisional plan'}</span>
        </li>)}</ul>
        {download?.snapshot === preview && <a className="button-link" href={download.url} download={preview.filename}>Download {kind.endsWith('.csv') ? 'CSV' : 'calendar (.ics)'}</a>}
        <p className="field-note export-filename">{preview.filename}</p>
      </>}
      <p className="field-note">Exports contain trip details and traveller display names. Account credentials and profile notes are excluded. Travel exports are not a complete database backup.</p>
    </div>}
  </section>;
}
