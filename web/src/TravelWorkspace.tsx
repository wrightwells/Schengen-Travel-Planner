import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from './api';
import { TravelCalendar } from './TravelCalendar';
import { HomeScreen } from './HomeScreen';
import { ProofDocuments } from './ProofDocuments';
import { formatDate, Icon, Sheet } from './Design';
import type { Screen, PlannerView } from './Design';
import type { Assessment, Country, Participant, Segment, Traveller, Trip, TripDraft, Summary } from './api';

const message = (error: unknown) => error instanceof Error ? error.message : 'Please retry.';
const blankParticipant = (id: string, day: string): Participant => ({
  traveller_id: id, entry_date: day, exit_date: day,
  segments: [{ country_code: '', start_date: day, end_date: day }],
});
const copyDraft = (trip: Trip): TripDraft => ({
  title: trip.title, status: trip.status,
  participants: trip.participants.map(p => ({
    traveller_id: p.traveller_id, entry_date: p.entry_date, exit_date: p.exit_date,
    segments: p.segments.map(s => ({ country_code: s.country_code, start_date: s.start_date, end_date: s.end_date })),
  })),
});
type Itinerary = Omit<Participant, 'traveller_id'>;
const copyItinerary = (p: Itinerary): Itinerary => ({
  entry_date: p.entry_date, exit_date: p.exit_date,
  segments: p.segments.map(s => ({ country_code: s.country_code, start_date: s.start_date, end_date: s.end_date })),
});
const itineraryKey = (p: Itinerary) => JSON.stringify({ ...copyItinerary(p),
  segments: [...p.segments].map(s => [s.country_code, s.start_date, s.end_date]).sort(),
});
type Editor = { draft: TripDraft; id?: string; version?: number; confirming?: boolean;
  itinerary?: Itinerary; originalParticipants?: Participant[]; requiresSharedReview?: boolean; resizeReview?: string };


function CountryInput({ value, onChange, countries, label, day }: {
  value: string; onChange: (value: string) => void; countries: Country[]; label: string; day: string;
}) {
  const country = countries.find(c => c.code === value);
  const id = useId();
  return <div className="country-input"><label htmlFor={id}>{label}</label><input id={id} list="country-options" required autoComplete="off" placeholder="Search a country"
    aria-describedby={country?.note ? `${id}-note` : undefined}
    value={country?.name || value} onChange={event => {
      const text = event.target.value;
      onChange(countries.find(c => c.name.toLowerCase() === text.toLowerCase() || c.code === text.toUpperCase())?.code || text);
    }} />{country && <small className="field-note">{country.memberships.find(m => m.effective_from <= day && (!m.effective_to || m.effective_to >= day))?.is_schengen ? 'Schengen destination · Days count towards your allowance' : 'Non-Schengen destination · Days do not consume your allowance'}</small>}{country?.note && <small id={`${id}-note`} className="field-note">{country.note}</small>}</div>;
}

function ItineraryEditor({ participant, onChange, countries }: {
  participant: Itinerary; onChange: (p: Itinerary) => void; countries: Country[];
}) {
  function changeDate(key: 'entry_date' | 'exit_date', value: string) {
    const segmentKey = key === 'entry_date' ? 'start_date' : 'end_date';
    onChange({ ...participant, [key]: value, segments: participant.segments.length === 1
      ? [{ ...participant.segments[0], [segmentKey]: value }] : participant.segments });
  }
  function changeSegment(index: number, value: Partial<Segment>) {
    onChange({ ...participant, segments: participant.segments.map((segment, i) => i === index ? { ...segment, ...value } : segment) });
  }
  return <fieldset className="participant-editor shared-itinerary"><legend>2 · Travel dates &amp; 3 · Destinations</legend>
    <div className="date-pair"><label>Entry date<input type="date" value={participant.entry_date} required min="2013-04-22" max="2100-12-31"
      onChange={e => changeDate('entry_date', e.target.value)} /></label>
      <label>Exit date<input type="date" value={participant.exit_date} required min={participant.entry_date || '2013-04-22'} max="2100-12-31"
        onChange={e => changeDate('exit_date', e.target.value)} /></label></div>
    <p className="duration-note">{participant.entry_date && participant.exit_date && participant.exit_date >= participant.entry_date ? `${Math.round((Date.parse(participant.exit_date) - Date.parse(participant.entry_date)) / 86400000) + 1} calendar days · Entry and exit included` : 'Choose an inclusive date range'}</p>
    {participant.segments.map((segment, index) => <div className="segment-editor" key={index}>
      <div className="segment-heading"><strong>Destination {index + 1}</strong>{participant.segments.length > 1 &&
        <button type="button" className="text-button" aria-label={`Remove destination ${index + 1}`}
          onClick={() => onChange({ ...participant, segments: participant.segments.filter((_, i) => i !== index) })}>Remove</button>}</div>
      <CountryInput value={segment.country_code} onChange={value => changeSegment(index, { country_code: value })}
        countries={countries} day={segment.start_date} label="Country" />
      {participant.segments.length > 1 && <div className="date-pair">
        <label>Country arrival<input type="date" value={segment.start_date} required min={participant.entry_date}
          max={participant.exit_date} onChange={e => changeSegment(index, { start_date: e.target.value })} /></label>
        <label>Country departure<input type="date" value={segment.end_date} required min={segment.start_date}
          max={participant.exit_date} onChange={e => changeSegment(index, { end_date: e.target.value })} /></label></div>}
    </div>)}
    <button type="button" className="secondary" disabled={participant.segments.length >= 40}
      onClick={() => onChange({ ...participant, segments: [...participant.segments, {
        country_code: '', start_date: participant.segments.at(-1)?.end_date || participant.entry_date,
        end_date: participant.exit_date,
      }] })}>Add country</button>
  </fieldset>;
}

const statusText: Record<string, string> = {
  PERMITTED: 'Permitted in selected scenario', APPROACHING_LIMIT: 'Approaching limit — stay within allowance',
  OVER_LIMIT: 'Over limit', UNKNOWN: 'Unknown — history needs review',
  NOT_ASSESSED: 'Not assessed — check immigration status', NOT_APPLICABLE: 'No Schengen presence',
};

function Results({ results, loading, error }: { results: Assessment[] | null; loading: boolean; error: string }) {
  return <aside className="scenario-results" aria-live="polite" aria-label="Scenario assessment">
    <span className="eyebrow">4 · REVIEW YOUR SCENARIO</span><h3>Before you book</h3>
    {loading ? <p role="status">Checking every day of the itinerary…</p> : error ? <p className="error" role="alert">{error}</p>
      : !results ? <p>Add travellers, dates and countries to preview the whole stay.</p>
      : results.map(person => <section key={person.traveller_id} className={`result result-${person.status.toLowerCase()}`}>
        <h4>{person.display_name}</h4><strong>{statusText[person.status] || person.status}</strong>
        <p>{person.schengen_days} Schengen days in this trip</p>
        {person.first_breach_date && <p>First breach: <b>{person.first_breach_date}</b>. Peak excess: {person.excess_days} day(s).</p>}
        {!['UNKNOWN', 'NOT_ASSESSED', 'NOT_APPLICABLE'].includes(person.status) && <>
          <dl className="result-metrics"><div><dt>Peak usage including affected later travel</dt><dd>{person.peak_rolling_days} / 90</dd></div>
            <div><dt>Remaining at entry / exit</dt><dd>{person.remaining_at_entry} / {person.remaining_at_exit} days</dd></div>
            <div><dt>Maximum uninterrupted stay under the rule</dt><dd>{person.maximum_contiguous_stay_days} days</dd></div>
            <div><dt>Earliest one-day visit</dt><dd>{person.earliest_one_day_entry || 'None within horizon'}</dd></div>
            <div><dt>Earliest entry for this full itinerary</dt><dd>{person.earliest_full_trip_entry || 'None within horizon'}</dd></div></dl>
          <small>Search ends {person.search_end_date}. Entry and exit both count. Remaining at entry includes the entry day and does not reserve days for future plans. The assessment also checks affected later selected travel. Maximum stay shows rule capacity; also check your other saved travel dates.</small>
        </>}
        {person.warnings.map(warning => <p className="result-warning" key={warning}>{warning}</p>)}
      </section>)}
    <p className="field-note">Based on confirmed history and only the saved plans you include below. Saving a plan does not confirm that travel occurred.</p>
  </aside>;
}

function TripEditor({ editor, setEditor, travellers, countries, referenceDate, includedPlans, csrf, onSaved, onExpired }: {
  editor: Editor; setEditor: (editor: Editor | null) => void; travellers: Traveller[]; countries: Country[];
  referenceDate: string; includedPlans: string[]; csrf: string; onSaved: (saved: Trip) => void; onExpired: () => void;
}) {
  const errorId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Assessment[] | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<{ traveller_id: string; schengen_days: number }[] | null>(null);
  const [assessmentError, setAssessmentError] = useState('');
  const container = useRef<HTMLDialogElement>(null);
  const { draft } = editor;
  const planned = draft.status === 'PLANNED';
  const itinerary = editor.itinerary || copyItinerary(draft.participants[0] || blankParticipant('', referenceDate));
  function participantsFor(value: Itinerary, ids = draft.participants.map(p => p.traveller_id)): Participant[] {
    return ids.map(id => ({ traveller_id: id, ...copyItinerary(value) }));
  }
  function changeItinerary(value: Itinerary) {
    setError('');
    setEditor({ ...editor, itinerary: copyItinerary(value), draft: { ...draft, participants: participantsFor(value) } });
  }
  function changeDraft(value: Partial<TripDraft>) { setError(''); setEditor({ ...editor, draft: { ...draft, ...value } }); }
  useEffect(() => { const element = container.current; element?.showModal(); return () => element?.close(); }, []);
  useEffect(() => {
    setResults(null); setHistoryPreview(null); setAssessmentError(''); setAssessing(false);
    if (editor.requiresSharedReview || !draft.participants.length || draft.participants.some(p =>
      !p.entry_date || !p.exit_date || p.segments.some(s => !countries.some(c => c.code === s.country_code) || !s.start_date || !s.end_date))) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setAssessing(true);
      if (!planned) {
        api<{ participants: { traveller_id: string; schengen_days: number }[] }>('/trips/preview', { method: 'POST', signal: controller.signal, body: JSON.stringify({ candidate: { ...draft, title: draft.title || 'History preview' }, exclude_trip_id: editor.id || null }) }, csrf).then(data => { if (active) setHistoryPreview(data.participants); }).catch(error => { if (active) setAssessmentError(message(error)); }).finally(() => { if (active) setAssessing(false); });
        return;
      }
      api<{ travellers: Assessment[] }>('/eligibility/evaluate', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ candidate: { ...draft, title: draft.title.trim() || 'Unsaved scenario' },
          included_plan_ids: includedPlans, exclude_trip_id: editor.id || null }),
      }, csrf).then(data => { if (active) setResults(data.travellers); }).catch(error => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) onExpired();
        setAssessmentError(message(error));
      }).finally(() => { if (active) setAssessing(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [draft, includedPlans, editor.id, editor.requiresSharedReview, countries, csrf, travellers]);

  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    if (!draft.participants.length) { setError('Select at least one traveller.'); setSaving(false); return; }
    if (editor.requiresSharedReview) { setError('Review the shared itinerary before saving.'); setSaving(false); return; }
    try {
      const path = editor.id ? `/trips/${editor.id}${editor.confirming ? '/confirm' : ''}` : '/trips';
      const saved = await api<Trip>(path, { method: editor.id && !editor.confirming ? 'PATCH' : 'POST',
        body: JSON.stringify({ ...draft, participants: participantsFor(itinerary), ...(editor.id ? { version: editor.version } : {}) }) }, csrf);
      onSaved(saved); setEditor(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      setError(message(error));
    } finally { setSaving(false); }
  }
  return <dialog ref={container} aria-label="Trip editor" onCancel={event => { event.preventDefault(); if (!saving) setEditor(null); }} className={`trip-editor card ${planned ? 'planner-editor' : ''}`}>
    <div className="sheet-heading"><span className="eyebrow">YOUR JOURNEY, STEP BY STEP</span><button type="button" className="secondary icon-button" aria-label="Close trip editor" disabled={saving} onClick={() => setEditor(null)}><Icon name="close" /></button></div>
    <h3>{editor.confirming ? 'Review actual travel dates' : editor.id ? 'Edit trip' : planned ? 'Build a travel scenario' : 'Record a trip'}</h3>
    {editor.resizeReview && <p className="notice">{editor.resizeReview} Review the adjusted dates and country segments below before saving.</p>}
    {editor.confirming && <p>Review the actual dates and destinations, then select who travelled before confirming this plan as history.</p>}
    <div className={planned ? 'planner-grid' : ''}><form onSubmit={save} aria-describedby={error ? errorId : undefined}>
      <label>Trip name<input value={draft.title} required maxLength={150} onChange={e => changeDraft({ title: e.target.value })} placeholder="e.g. Spring in France" /></label>
      <fieldset className="traveller-selection"><legend>1 · Who is travelling?</legend>{travellers.map(person => <label key={person.id}>
        <input type="checkbox" checked={draft.participants.some(p => p.traveller_id === person.id)} onChange={e => {
          const ids = draft.participants.map(p => p.traveller_id);
          changeDraft({ participants: participantsFor(itinerary, e.target.checked ? [...ids, person.id] : ids.filter(id => id !== person.id)) });
        }} />{person.display_name}</label>)}</fieldset>
      <p className="field-note">Enter dates and destinations once. They apply to every selected traveller; allowances are assessed separately.</p>
      {editor.originalParticipants && <div className="notice shared-itinerary-review">
        <p>This saved trip has different dates or destinations for its travellers. Review the existing itineraries and choose the shared itinerary to apply when saving.</p>
        <ul>{editor.originalParticipants.map(p => <li key={p.traveller_id}>
          <strong>{travellers.find(t => t.id === p.traveller_id)?.display_name}</strong>: {p.entry_date} → {p.exit_date}
          <ul>{p.segments.map((segment, i) => <li key={i}>{countries.find(c => c.code === segment.country_code)?.name || segment.country_code}: {segment.start_date} → {segment.end_date}</li>)}</ul>
        </li>)}</ul>
        <label>Copy existing itinerary from<select defaultValue={editor.originalParticipants[0].traveller_id} onChange={e => {
          const source = editor.originalParticipants?.find(p => p.traveller_id === e.target.value);
          if (source) changeItinerary(copyItinerary(source));
        }}>{editor.originalParticipants.map(p => <option key={p.traveller_id} value={p.traveller_id}>{travellers.find(t => t.id === p.traveller_id)?.display_name}</option>)}</select></label>
        <label className="include-plan"><input type="checkbox" checked={!editor.requiresSharedReview} onChange={e => {
          setEditor({ ...editor, requiresSharedReview: !e.target.checked, draft: { ...draft, participants: participantsFor(itinerary) } });
        }} />Apply the shared dates and destinations to every selected traveller</label>
      </div>}
      <ItineraryEditor participant={itinerary} countries={countries} onChange={changeItinerary} />
      <p className="field-note">Dates are inclusive. Cover every itinerary day, including non-Schengen destinations. A border-crossing day can appear in both adjoining countries.</p>
      {error && <p id={errorId} role="alert" className="error">{error}</p>}
      {!planned && <aside className="history-preview" aria-label="History day count" aria-live="polite"><h4>4 · Review counted days</h4>{assessing ? <p>Counting travel days…</p> : assessmentError ? <p className="error" role="alert">{assessmentError}</p> : historyPreview ? historyPreview.map(p => <p key={p.traveller_id}>{travellers.find(t => t.id === p.traveller_id)?.display_name}: <strong>{p.schengen_days} Schengen days</strong></p>) : <p>Choose travellers, dates and countries to preview the count.</p>}</aside>}
      <p className="field-note">5 · Save after reviewing dates, destinations and each traveller’s assessment. {planned ? 'New plans are excluded from your scenario by default.' : 'Saving confirms this travel and clears the affected history reviews.'}</p><div className="actions editor-actions"><button disabled={saving || !!editor.requiresSharedReview}>{saving ? 'Saving…' : editor.confirming ? 'Confirm actual travel'
        : planned ? 'Save plan' : editor.id ? 'Save changes' : 'Save history'}</button>
        <button type="button" className="secondary" disabled={saving} onClick={() => setEditor(null)}>Cancel</button></div>
    </form>{planned && <Results results={results} loading={assessing} error={assessmentError} />}</div>
  </dialog>;
}

function TripRow({ trip, travellers, shownParticipants, onEdit, onDelete, onDuplicate, onConfirm, included, onInclude, onDetail, hasProofs }: {
  onDetail?: () => void; trip: Trip; travellers: Traveller[]; shownParticipants?: Trip['participants']; onEdit: () => void;
  onDelete: () => void; onDuplicate?: () => void; onConfirm?: () => void; included?: boolean; onInclude?: (value: boolean) => void;
  hasProofs?: boolean;
}) {
  const people = shownParticipants || trip.participants;
  const shared = new Set(people.map(itineraryKey)).size === 1;
  const groups = shared ? [people[0]] : people;
  return <article className="trip-row"><div className="trip-row-heading"><button className="trip-title" onClick={onDetail || onEdit}><span className="trip-icon"><Icon name={trip.status === 'HISTORY' ? 'history' : 'planner'} /></span><h4>{trip.title}</h4></button>
    <span className={`trip-kind ${trip.status.toLowerCase()}`}>{trip.status === 'HISTORY' ? 'Confirmed history' : 'Provisional plan'}</span></div>
    <div className="avatar-chips">{trip.participants.map(p => <span key={p.traveller_id}><span className="avatar small" aria-hidden="true">{travellers.find(t => t.id === p.traveller_id)?.display_name[0]}</span>{travellers.find(t => t.id === p.traveller_id)?.display_name}</span>)}</div>
    {groups.map(person => <div className="trip-person" key={person.traveller_id}>
      {!shared && <strong>{travellers.find(t => t.id === person.traveller_id)?.display_name}</strong>}
      <span>{formatDate(person.entry_date)} → {formatDate(person.exit_date)}</span><b>{person.schengen_days} Schengen day{person.schengen_days === 1 ? '' : 's'}</b>
      <div className="trip-destinations">{person.segments.map((segment, i) => <span key={i}>
        {segment.country_name || segment.country_code}{person.segments.length > 1 && ` · ${formatDate(segment.start_date)} – ${formatDate(segment.end_date)}`}</span>)}</div>
    </div>)}
    <div className="trip-row-footer"><div className="actions"><button type="button" className="text-button" onClick={onEdit} aria-label={`Edit ${trip.title}`}>Edit</button>
      {trip.status === 'HISTORY' && onDetail && <button type="button" className="text-button" onClick={onDetail} aria-label={`Proof documents for ${trip.title}`} title={hasProofs ? 'Proof uploaded' : undefined}>Proof documents {hasProofs && <span className="proof-uploaded-tick" role="img" aria-label="Proof uploaded">✓</span>}</button>}
      {onDuplicate && <button type="button" className="text-button" onClick={onDuplicate} aria-label={`Duplicate ${trip.title}`}>Duplicate</button>}
      {onConfirm && <button type="button" className="text-button" onClick={onConfirm} aria-label={`Confirm ${trip.title} as history`}>Confirm as history</button>}
      <button type="button" className="text-button danger" onClick={onDelete} aria-label={`Delete ${trip.title}`}>Delete</button></div>
      {onInclude && <label className="include-plan"><input type="checkbox" checked={included} onChange={e => onInclude(e.target.checked)} />Include in scenario</label>}</div>
  </article>;

}

export function TravelWorkspace({ travellers, csrf, referenceDate, revision, onChanged, onExpired, screen, onNavigate, selectedTraveller, onSelectTraveller, plannerView, onPlannerView, summary }: {
  screen: Screen; onNavigate: (screen: Screen) => void; selectedTraveller: string; onSelectTraveller: (id: string) => void; plannerView: PlannerView; onPlannerView: (view: PlannerView) => void; summary: Summary | null;
  travellers: Traveller[]; csrf: string; referenceDate: string; revision: number;
  onChanged: (historyTravellerIds?: string[]) => void; onExpired: () => void;
}) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [includedPlans, setIncludedPlans] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('schengen-included-plans') || '[]');
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string').slice(0, 100) : [];
    } catch { return []; }
  });
  const travellerFilter = selectedTraveller;
  const setTravellerFilter = onSelectTraveller;
  const [assessments, setAssessments] = useState<Record<string, Assessment[] | string>>({});
  const [detailTrip, setDetailTrip] = useState<Trip | null>(null);
  const [proofCounts, setProofCounts] = useState<Record<string, number>>({});
  const [countryFilter, setCountryFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [startFilter, setStartFilter] = useState('');
  const [endFilter, setEndFilter] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    Promise.all([api<{ countries: Country[] }>('/countries'), api<Trip[]>('/trips')]).then(([data, trips]) => {
      if (!active) return;
      setCountries(data.countries); setTrips(trips);
      setIncludedPlans(ids => ids.filter(id => trips.some(t => t.id === id && t.status === 'PLANNED')));
    }).catch(error => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) onExpired();
      setError(message(error));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision, refresh]);
  useEffect(() => {
    if (screen !== 'history' || loading) return;
    const controller = new AbortController();
    setProofCounts({});
    trips.filter(trip => trip.status === 'HISTORY').forEach(trip => {
      api<unknown[]>(`/trips/${trip.id}/proofs`, { signal: controller.signal }).then(proofs => {
        if (!controller.signal.aborted) setProofCounts(counts => trip.id in counts ? counts : { ...counts, [trip.id]: proofs.length });
      }).catch(error => {
        if (!controller.signal.aborted && error instanceof ApiError && error.status === 401) onExpired();
      });
    });
    return () => controller.abort();
  }, [trips, screen, loading]);
  useEffect(() => {
    if (loading) return;
    try { localStorage.setItem('schengen-included-plans', JSON.stringify(includedPlans)); } catch { /* Storage may be disabled. */ }
  }, [includedPlans, loading]);
  useEffect(() => {
    if (loading || (screen !== 'home' && screen !== 'planner')) return;
    const controller = new AbortController();
    setAssessments({});
    trips.filter(t => t.status === 'PLANNED').forEach(trip => {
      api<{ travellers: Assessment[] }>('/eligibility/evaluate', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ candidate: copyDraft(trip), included_plan_ids: includedPlans, exclude_trip_id: trip.id, search_days: 1 }),
      }, csrf).then(result => { if (!controller.signal.aborted) setAssessments(old => ({ ...old, [trip.id]: result.travellers })); })
        .catch(error => { if (!controller.signal.aborted) { if (error instanceof ApiError && error.status === 401) onExpired(); setAssessments(old => ({ ...old, [trip.id]: `Unassessed: ${message(error)}` })); } });
    });
    return () => controller.abort();
  }, [trips, includedPlans, loading, revision, csrf, screen]);
  function open(nextEditor: Editor) {
    if (editor && !window.confirm('Replace the open editor? Unsaved changes in that editor will be discarded.')) return;
    const originalParticipants = nextEditor.draft.participants;
    const different = new Set(originalParticipants.map(itineraryKey)).size > 1;
    setFeedback(''); setEditor({ ...nextEditor,
      itinerary: copyItinerary(originalParticipants[0] || blankParticipant('', referenceDate)),
      originalParticipants: different ? originalParticipants.map(p => ({ traveller_id: p.traveller_id, ...copyItinerary(p) })) : undefined,
      requiresSharedReview: different,
    });
  }
  function add(status: TripDraft['status']) {
    open({ draft: { title: '', status, participants: travellers.filter(p => !selectedTraveller || p.id === selectedTraveller).map(p => blankParticipant(p.id, referenceDate)) } });
  }
  async function remove(trip: Trip) {
    if (!window.confirm(`Delete “${trip.title}” for all its travellers? This removes the saved trip. An audit record is retained.`)) return;
    setError('');
    try {
      await api(`/trips/${trip.id}?version=${trip.version}`, { method: 'DELETE' }, csrf);
      setTrips(items => items.filter(item => item.id !== trip.id));
      setIncludedPlans(ids => ids.filter(id => id !== trip.id));
      if (editor?.id === trip.id) setEditor(null);
      setFeedback('Trip deleted.'); onChanged(trip.status === 'HISTORY' ? trip.participants.map(p => p.traveller_id) : undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      setError(message(error));
    }
  }
  const history = trips.filter(t => t.status === 'HISTORY');
  const plans = trips.filter(t => t.status === 'PLANNED' && (!selectedTraveller || t.participants.some(p => p.traveller_id === selectedTraveller))).sort((a,b) => a.participants[0].entry_date.localeCompare(b.participants[0].entry_date));
  const years = [...new Set(history.flatMap(t => t.participants.flatMap(p => {
    const result = []; for (let year = Number(p.entry_date.slice(0, 4)); year <= Number(p.exit_date.slice(0, 4)); year++) result.push(String(year));
    return result;
  })))].sort().reverse();
  function matching(trip: Trip) {
    return trip.participants.filter(p => (!travellerFilter || p.traveller_id === travellerFilter)
      && (!countryFilter || p.segments.some(s => s.country_code === countryFilter))
      && (!yearFilter || p.entry_date <= `${yearFilter}-12-31` && p.exit_date >= `${yearFilter}-01-01`)
      && (!startFilter || p.exit_date >= startFilter) && (!endFilter || p.entry_date <= endFilter));
  }
  const visibleHistory = history.filter(t => matching(t).length);
  const editorProps = { setEditor, travellers, countries, referenceDate, includedPlans, csrf,
    onSaved: (saved: Trip) => {
      const previous = trips.find(trip => trip.id === saved.id);
      if (saved.status === 'HISTORY') setIncludedPlans(ids => ids.filter(id => id !== saved.id));
      const affected = saved.status === 'HISTORY' ? [...new Set([
        ...saved.participants.map(p => p.traveller_id),
        ...(previous?.participants.map(p => p.traveller_id) || []),
      ])] : undefined;
      setTrips(items => [...items.filter(item => item.id !== saved.id), saved].sort((a, b) =>
        b.participants.map(p => p.entry_date).sort().at(-1)!.localeCompare(a.participants.map(p => p.entry_date).sort().at(-1)!)));
      setFeedback(saved.status === 'HISTORY' ? 'History saved. Please review completeness for the affected travellers.' : 'Provisional plan saved.');
      onChanged(affected);
    }, onExpired };
  function resizedTrip(trip: Trip, travellerId: string, edge: 'start' | 'end', date: string): TripDraft {
    const source = trip.participants.find(p => p.traveller_id === travellerId);
    if (!source) throw new Error('Traveller is no longer on this trip. Reload travel data.');
    const participants = copyDraft(trip).participants.map(person => {
      if (itineraryKey(person) !== itineraryKey(source)) return person;
      const start = edge === 'start' ? date : person.entry_date;
      const end = edge === 'end' ? date : person.exit_date;
      const ordered = [...person.segments].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.end_date.localeCompare(b.end_date));
      const segments = ordered.map(segment => ({ ...segment,
        start_date: segment.start_date < start ? start : segment.start_date,
        end_date: segment.end_date > end ? end : segment.end_date,
      })).filter(segment => segment.start_date <= segment.end_date);
      if (!segments.length) throw new Error('Use the trip editor to review destinations for these dates.');
      if (start < person.entry_date) segments[0].start_date = start;
      if (end > person.exit_date) segments[segments.length - 1].end_date = end;
      return { ...person, entry_date: start, exit_date: end, segments };
    });
    return { title: trip.title, status: trip.status, participants };
  }
  async function previewResize(trip: Trip, travellerId: string, edge: 'start' | 'end', date: string) {
    if (trip.status === 'HISTORY') return 'History change · Review before saving';
    try {
      const result = await api<{ travellers: Assessment[] }>('/eligibility/evaluate', { method: 'POST', body: JSON.stringify({ candidate: resizedTrip(trip, travellerId, edge, date), included_plan_ids: includedPlans, exclude_trip_id: trip.id, search_days: 1 }) }, csrf);
      return result.travellers.map(p => `${p.display_name}: ${p.status === 'OVER_LIMIT' ? `Over limit from ${formatDate(p.first_breach_date!)}` : p.status === 'PERMITTED' ? 'Eligible' : p.status === 'APPROACHING_LIMIT' ? 'Within allowance · Near limit' : 'Unassessed'}`).join(' · ');
    } catch (error) { return `Unassessed: ${message(error)}`; }
  }
  async function resizeTrip(trip: Trip, travellerId: string, edge: 'start' | 'end', date: string) {
    const draft = resizedTrip(trip, travellerId, edge, date);
    const changed = draft.participants.filter((p,i) => itineraryKey(p) !== itineraryKey(trip.participants[i]));
    open({ draft, id: trip.id, version: trip.version,
      resizeReview: `Timeline change affects ${changed.map(p => travellers.find(t => t.id === p.traveller_id)?.display_name).join(' and ')}.` });
  }
  return <div className="travel-workspace"><datalist id="country-options">{countries.map(country => <option key={country.code} value={country.name}>{country.code}</option>)}</datalist>
    {error && <div role="alert" className="notice"><p className="error">{error}</p><button onClick={() => setRefresh(refresh + 1)}>Reload travel data</button></div>}
    {loading && <div className="loading-skeleton" role="status" aria-label="Loading travel"><span /><span /></div>}
    {error && trips.length > 0 && <p className="notice">Previously loaded records are shown below. Refresh before relying on them.</p>}
    {feedback && <p role="status" className="success-message">{feedback}</p>}
    {screen === 'home' && !loading && !error && <HomeScreen travellers={travellers} selected={selectedTraveller} summary={summary} trips={trips} includedPlans={includedPlans} assessments={assessments}
      onManage={() => onNavigate('more')} onPlan={() => { onNavigate('planner'); add('PLANNED'); }} onTrip={setDetailTrip} onPlanner={() => { onNavigate('planner'); onPlannerView('trips'); }} />}
    {editor && <TripEditor key={`${editor.id || 'new'}-${editor.confirming || false}`} editor={editor} {...editorProps} />}
    {detailTrip && <Sheet title={detailTrip.title} onClose={() => setDetailTrip(null)}><p className="trip-kind">{detailTrip.status === 'HISTORY' ? 'Confirmed history' : 'Provisional plan'}</p>
      {detailTrip.status === 'HISTORY' && <ProofDocuments key={detailTrip.id} tripId={detailTrip.id} csrf={csrf} onExpired={onExpired} onCountChanged={count => setProofCounts(counts => ({ ...counts, [detailTrip.id]: count }))} />}
      {detailTrip.participants.map(p => <div className="detail-itinerary" key={p.traveller_id}><h4>{travellers.find(t => t.id === p.traveller_id)?.display_name}</h4><p>{formatDate(p.entry_date)} – {formatDate(p.exit_date)} · {p.schengen_days} Schengen days</p>{p.segments.map((segment,i) => <p key={i}>{segment.country_name || segment.country_code} · {formatDate(segment.start_date)} – {formatDate(segment.end_date)}</p>)}</div>)}
      <div className="actions"><button onClick={() => { open({ draft: copyDraft(detailTrip), id: detailTrip.id, version: detailTrip.version }); setDetailTrip(null); }}>Edit trip</button>{detailTrip.status === 'PLANNED' && <><button className="secondary" onClick={() => { open({ draft: { ...copyDraft(detailTrip), title: `${detailTrip.title} (copy)` } }); setDetailTrip(null); }}>Duplicate</button><button className="secondary" onClick={() => { open({ draft: { ...copyDraft(detailTrip), status: 'HISTORY' }, id: detailTrip.id, version: detailTrip.version, confirming: true }); setDetailTrip(null); }}>Confirm as history</button><label className="include-plan"><input type="checkbox" checked={includedPlans.includes(detailTrip.id)} onChange={e => setIncludedPlans(ids => e.target.checked ? [...ids,detailTrip.id] : ids.filter(id => id !== detailTrip.id))} />Include in scenario</label></>}<button className="text-button danger" onClick={() => { void remove(detailTrip); setDetailTrip(null); }}>Delete trip</button><button className="secondary" onClick={() => { onNavigate('planner'); onPlannerView('trips'); setDetailTrip(null); }}>View in planner</button></div></Sheet>}
    {screen === 'history' && <section aria-labelledby="history-heading" className="workspace-section">
      <div className="section-heading"><div><span className="eyebrow">YOUR RECORDED JOURNEYS</span><h2 id="history-heading">Travel History</h2></div>
        <button onClick={() => add('HISTORY')} disabled={!countries.length || !!editor}>Add history</button></div>
      <p className="intro">Confirmed travel, kept separately for each person. Both entry and exit dates count.</p>
      <div className="history-filters"><label>Filter by traveller<select value={travellerFilter} onChange={e => setTravellerFilter(e.target.value)}>
        <option value="">Both travellers</option>{travellers.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}</select></label>
        <label>Filter by country<select value={countryFilter} onChange={e => setCountryFilter(e.target.value)}><option value="">All countries</option>
          {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <label>Year<select value={yearFilter} onChange={e => setYearFilter(e.target.value)}><option value="">All years</option>
          {years.map(year => <option key={year}>{year}</option>)}</select></label>
        <label>From<input type="date" value={startFilter} onChange={e => setStartFilter(e.target.value)} /></label>
        <label>Until<input type="date" value={endFilter} min={startFilter} onChange={e => setEndFilter(e.target.value)} /></label></div>
      {startFilter && endFilter && startFilter > endFilter && <p className="error" role="alert">Filter start must be on or before the end date.</p>}
      {loading && <p role="status">Loading recorded journeys…</p>}
      {!loading && !visibleHistory.length && <div className="empty-state">{history.length ? 'No trips match these filters.' : 'No travel history yet. Record past trips, or confirm a complete history with no travel.'}</div>}
      <ul className="trip-list">{visibleHistory.map(trip => <li key={trip.id}><TripRow onDetail={() => setDetailTrip(trip)} trip={trip} travellers={travellers} shownParticipants={matching(trip)} hasProofs={proofCounts[trip.id] > 0}
        onEdit={() => open({ draft: copyDraft(trip), id: trip.id, version: trip.version })} onDelete={() => remove(trip)} /></li>)}</ul>
    </section>}
    {screen === 'planner' && <section aria-labelledby="planner-heading" className={`workspace-section planner-${plannerView}`}>
      <div className="section-heading"><div><span className="eyebrow">LOOK AHEAD, DAY BY DAY</span><h2 id="planner-heading">Plan Future Travel</h2></div>
        <button onClick={() => add('PLANNED')} disabled={!countries.length || !!editor}>Plan a trip</button></div>
      <p className="intro">Enter one itinerary and select who is travelling. Each traveller’s allowance is assessed separately before saving.</p>
      <div className="planner-tabs" role="group" aria-label="Planner view">{(['trips','calendar','timeline'] as const).map(view => <button key={view} aria-pressed={view === plannerView} onClick={() => onPlannerView(view)}>{view[0].toUpperCase() + view.slice(1)}</button>)}</div>
      <details className="scenario-options"><summary>{includedPlans.length} plans included · Manage scenario</summary><p>Saved per browser. New plans start excluded.</p>{trips.filter(t => t.status === 'PLANNED').map(trip => <label key={trip.id} className="include-plan"><input type="checkbox" checked={includedPlans.includes(trip.id)} onChange={e => setIncludedPlans(ids => e.target.checked ? [...ids, trip.id] : ids.filter(id => id !== trip.id))} />{trip.title}</label>)}</details>
      {plannerView === 'trips' && <><h3>Saved plans &amp; scenario baseline</h3><p className="field-note">Plans stay provisional. Include the journeys you want to assess together; new plans start excluded.</p>
      {!loading && !plans.length && <div className="empty-state">No saved plans. Build a scenario to see when and how long you could travel.</div>}
      <ul className="trip-list">{plans.map(trip => <li className="plan-card-group" key={trip.id}><TripRow onDetail={() => setDetailTrip(trip)} key={trip.id} trip={trip} travellers={travellers}
        onEdit={() => open({ draft: copyDraft(trip), id: trip.id, version: trip.version })} onDelete={() => remove(trip)}
        onDuplicate={() => open({ draft: { ...copyDraft(trip), title: `${trip.title.slice(0, 140)} (copy)` } })}
        onConfirm={() => open({ draft: { ...copyDraft(trip), status: 'HISTORY' }, id: trip.id, version: trip.version, confirming: true })}
        included={includedPlans.includes(trip.id)} onInclude={value => {
          setIncludedPlans(ids => value ? [...ids, trip.id] : ids.filter(id => id !== trip.id));
        }} />{Array.isArray(assessments[trip.id]) ? <div className="plan-assessments">{(assessments[trip.id] as Assessment[]).map(p => <span className={`eligibility ${p.status.toLowerCase()}`} key={p.traveller_id}>{p.display_name} · {p.status === 'PERMITTED' ? 'Eligible' : p.status === 'APPROACHING_LIMIT' ? 'Eligible · Near limit' : p.status === 'OVER_LIMIT' ? `Over limit · ${formatDate(p.first_breach_date!)}` : 'Unassessed'}</span>)}</div> : <p className="field-note">{typeof assessments[trip.id] === 'string' ? String(assessments[trip.id]) : 'Checking eligibility…'}</p>}</li>)}</ul></>}
    </section>}
    {screen === 'planner' && plannerView !== 'trips' && <TravelCalendar onModeChange={view => onPlannerView(view === 'gantt' ? 'timeline' : 'calendar')} onPreviewResize={previewResize} onEditTrip={trip => open({ draft: copyDraft(trip), id: trip.id, version: trip.version })} plannerView={plannerView} selectedTraveller={selectedTraveller} trips={trips} resizeDisabled={!!editor} onResize={resizeTrip} travellers={travellers} includedPlans={includedPlans} revision={`${revision}-${refresh}`}
      onExpired={onExpired} onPlan={(start, end, ids) => open({ draft: {
        title: '', status: 'PLANNED', participants: ids.map(id => ({
          traveller_id: id, entry_date: start, exit_date: end,
          segments: [{ country_code: '', start_date: start, end_date: end }],
        })),
      } })} />}
    {(screen === 'home' || screen === 'planner') && !editor && <button className="quick-plan" onClick={() => { onNavigate('planner'); add('PLANNED'); }}><Icon name="plus" />Plan trip</button>}
  </div>;
}
