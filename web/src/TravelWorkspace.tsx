import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from './api';
import { TravelCalendar } from './TravelCalendar';
import type { Assessment, Country, Participant, Segment, Traveller, Trip, TripDraft } from './api';

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
  itinerary?: Itinerary; originalParticipants?: Participant[]; requiresSharedReview?: boolean };


function CountryInput({ value, onChange, countries, label }: {
  value: string; onChange: (value: string) => void; countries: Country[]; label: string;
}) {
  const country = countries.find(c => c.code === value);
  const id = useId();
  return <div className="country-input"><label htmlFor={id}>{label}</label><input id={id} list="country-options" required autoComplete="off" placeholder="Search a country"
    aria-describedby={country?.note ? `${id}-note` : undefined}
    value={country?.name || value} onChange={event => {
      const text = event.target.value;
      onChange(countries.find(c => c.name.toLowerCase() === text.toLowerCase() || c.code === text.toUpperCase())?.code || text);
    }} />{country?.note && <small id={`${id}-note`} className="field-note">{country.note}</small>}</div>;
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
  return <fieldset className="participant-editor shared-itinerary"><legend>Trip dates and destinations</legend>
    <div className="date-pair"><label>Entry date<input type="date" value={participant.entry_date} required min="2013-04-22" max="2100-12-31"
      onChange={e => changeDate('entry_date', e.target.value)} /></label>
      <label>Exit date<input type="date" value={participant.exit_date} required min={participant.entry_date || '2013-04-22'} max="2100-12-31"
        onChange={e => changeDate('exit_date', e.target.value)} /></label></div>
    {participant.segments.map((segment, index) => <div className="segment-editor" key={index}>
      <div className="segment-heading"><strong>Destination {index + 1}</strong>{participant.segments.length > 1 &&
        <button type="button" className="text-button" aria-label={`Remove destination ${index + 1}`}
          onClick={() => onChange({ ...participant, segments: participant.segments.filter((_, i) => i !== index) })}>Remove</button>}</div>
      <CountryInput value={segment.country_code} onChange={value => changeSegment(index, { country_code: value })}
        countries={countries} label="Country" />
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
    <span className="eyebrow">YOUR SELECTED SCENARIO</span><h3>Before you book</h3>
    {loading ? <p role="status">Checking every day of the itinerary…</p> : error ? <p className="error" role="alert">{error}</p>
      : !results ? <p>Add travellers, dates and countries to preview the whole stay.</p>
      : results.map(person => <section key={person.traveller_id} className={`result result-${person.status.toLowerCase()}`}>
        <h4>{person.display_name}</h4><strong>{statusText[person.status] || person.status}</strong>
        {person.first_breach_date && <p>First breach: <b>{person.first_breach_date}</b>. Peak excess: {person.excess_days} day(s).</p>}
        {!['UNKNOWN', 'NOT_ASSESSED', 'NOT_APPLICABLE'].includes(person.status) && <>
          <dl className="result-metrics"><div><dt>Peak rolling usage</dt><dd>{person.peak_rolling_days} / 90</dd></div>
            <div><dt>Remaining at entry / exit</dt><dd>{person.remaining_at_entry} / {person.remaining_at_exit} days</dd></div>
            <div><dt>Maximum uninterrupted stay under the rule</dt><dd>{person.maximum_contiguous_stay_days} days</dd></div>
            <div><dt>Earliest one-day visit</dt><dd>{person.earliest_one_day_entry || 'None within horizon'}</dd></div>
            <div><dt>Earliest entry for this full itinerary</dt><dd>{person.earliest_full_trip_entry || 'None within horizon'}</dd></div></dl>
          <small>Search ends {person.search_end_date}. Entry and exit both count. Remaining at entry includes the entry day. Maximum stay shows rule capacity; also check your other saved travel dates.</small>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<Assessment[] | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [assessmentError, setAssessmentError] = useState('');
  const container = useRef<HTMLDivElement>(null);
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
  useEffect(() => { container.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, []);
  useEffect(() => {
    setResults(null); setAssessmentError(''); setAssessing(false);
    if (!planned || editor.requiresSharedReview || !draft.participants.length || draft.participants.some(p =>
      !p.entry_date || !p.exit_date || p.segments.some(s => !countries.some(c => c.code === s.country_code) || !s.start_date || !s.end_date))) return;
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setAssessing(true);
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
  return <div ref={container} className={`trip-editor card ${planned ? 'planner-editor' : ''}`}>
    <h3>{editor.confirming ? 'Review actual travel dates' : editor.id ? 'Edit trip' : planned ? 'Build a travel scenario' : 'Record a trip'}</h3>
    {editor.confirming && <p>Review the actual dates and destinations, then select who travelled before confirming this plan as history.</p>}
    <div className={planned ? 'planner-grid' : ''}><form onSubmit={save}>
      <label>Trip name<input value={draft.title} required maxLength={150} onChange={e => changeDraft({ title: e.target.value })} placeholder="e.g. Spring in France" /></label>
      <fieldset className="traveller-selection"><legend>Who is travelling?</legend>{travellers.map(person => <label key={person.id}>
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
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions"><button disabled={saving || !!editor.requiresSharedReview}>{saving ? 'Saving…' : editor.confirming ? 'Confirm actual travel'
        : planned ? 'Save plan' : editor.id ? 'Save changes' : 'Save history'}</button>
        <button type="button" className="secondary" disabled={saving} onClick={() => setEditor(null)}>Cancel</button></div>
    </form>{planned && <Results results={results} loading={assessing} error={assessmentError} />}</div>
  </div>;
}

function TripRow({ trip, travellers, shownParticipants, onEdit, onDelete, onDuplicate, onConfirm, included, onInclude }: {
  trip: Trip; travellers: Traveller[]; shownParticipants?: Trip['participants']; onEdit: () => void;
  onDelete: () => void; onDuplicate?: () => void; onConfirm?: () => void; included?: boolean; onInclude?: (value: boolean) => void;
}) {
  return <li className="trip-row"><div className="trip-row-heading"><h4>{trip.title}</h4>
    <span className={`trip-kind ${trip.status.toLowerCase()}`}>{trip.status === 'HISTORY' ? 'Confirmed history' : 'Provisional plan'}</span></div>
    {(shownParticipants || trip.participants).map(person => <div className="trip-person" key={person.traveller_id}>
      <strong>{travellers.find(t => t.id === person.traveller_id)?.display_name}</strong>
      <span>{person.entry_date} → {person.exit_date}</span><b>{person.schengen_days} Schengen day{person.schengen_days === 1 ? '' : 's'}</b>
      <div className="trip-destinations">{person.segments.map((segment, i) => <span key={i}>
        {segment.country_name || segment.country_code} · {segment.start_date} – {segment.end_date}</span>)}</div>
    </div>)}
    <div className="trip-row-footer"><div className="actions"><button type="button" className="text-button" onClick={onEdit} aria-label={`Edit ${trip.title}`}>Edit</button>
      {onDuplicate && <button type="button" className="text-button" onClick={onDuplicate} aria-label={`Duplicate ${trip.title}`}>Duplicate</button>}
      {onConfirm && <button type="button" className="text-button" onClick={onConfirm} aria-label={`Confirm ${trip.title} as history`}>Confirm as history</button>}
      <button type="button" className="text-button danger" onClick={onDelete} aria-label={`Delete ${trip.title}`}>Delete</button></div>
      {onInclude && <label className="include-plan"><input type="checkbox" checked={included} onChange={e => onInclude(e.target.checked)} />
        Include in scenario</label>}</div>
  </li>;
}

export function TravelWorkspace({ travellers, csrf, referenceDate, revision, onChanged, onExpired }: {
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
  const [travellerFilter, setTravellerFilter] = useState('');
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
    if (loading) return;
    try { localStorage.setItem('schengen-included-plans', JSON.stringify(includedPlans)); } catch { /* Storage may be disabled. */ }
  }, [includedPlans, loading]);
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
    open({ draft: { title: '', status, participants: travellers[0] ? [blankParticipant(travellers[0].id, referenceDate)] : [] } });
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
  const plans = trips.filter(t => t.status === 'PLANNED');
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
  return <div className="travel-workspace"><datalist id="country-options">{countries.map(country => <option key={country.code} value={country.name}>{country.code}</option>)}</datalist>
    {error && <div role="alert" className="notice"><p className="error">{error}</p><button onClick={() => setRefresh(refresh + 1)}>Reload travel data</button></div>}
    {feedback && <p role="status" className="success-message">{feedback}</p>}
    <section aria-labelledby="history-heading" className="workspace-section">
      <div className="section-heading"><div><span className="eyebrow">YOUR RECORDED JOURNEYS</span><h2 id="history-heading">Travel History</h2></div>
        <button onClick={() => add('HISTORY')} disabled={!countries.length || !!editor}>Add history</button></div>
      <p className="intro">Confirmed travel, kept separately for each person. Both entry and exit dates count.</p>
      {editor?.draft.status === 'HISTORY' && <TripEditor key={`${editor.id || 'new'}-${editor.confirming || false}`} editor={editor} {...editorProps} />}
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
      <ul className="trip-list">{visibleHistory.map(trip => <TripRow key={trip.id} trip={trip} travellers={travellers} shownParticipants={matching(trip)}
        onEdit={() => open({ draft: copyDraft(trip), id: trip.id, version: trip.version })} onDelete={() => remove(trip)} />)}</ul>
    </section>
    <section aria-labelledby="planner-heading" className="workspace-section">
      <div className="section-heading"><div><span className="eyebrow">LOOK AHEAD, DAY BY DAY</span><h2 id="planner-heading">Plan Future Travel</h2></div>
        <button onClick={() => add('PLANNED')} disabled={!countries.length || !!editor}>Plan a trip</button></div>
      <p className="intro">Enter one itinerary and select who is travelling. Each traveller’s allowance is assessed separately before saving.</p>
      {editor?.draft.status === 'PLANNED' && <TripEditor key={editor.id || 'new-plan'} editor={editor} {...editorProps} />}
      <h3>Saved plans &amp; scenario baseline</h3><p className="field-note">“Include in scenario” controls which planned trips appear on the calendar and count towards allowance calculations. New plans start excluded. Your included plans are remembered in this browser. Include only the plans you want to combine with your current scenario. Alternative plans may overlap until selected together.</p>
      {!loading && !plans.length && <div className="empty-state">No saved plans. Build a scenario to see when and how long you could travel.</div>}
      <ul className="trip-list">{plans.map(trip => <TripRow key={trip.id} trip={trip} travellers={travellers}
        onEdit={() => open({ draft: copyDraft(trip), id: trip.id, version: trip.version })} onDelete={() => remove(trip)}
        onDuplicate={() => open({ draft: { ...copyDraft(trip), title: `${trip.title.slice(0, 140)} (copy)` } })}
        onConfirm={() => open({ draft: { ...copyDraft(trip), status: 'HISTORY' }, id: trip.id, version: trip.version, confirming: true })}
        included={includedPlans.includes(trip.id)} onInclude={value => {
          setIncludedPlans(ids => value ? [...ids, trip.id] : ids.filter(id => id !== trip.id));
        }} />)}</ul>
    </section>
    <TravelCalendar travellers={travellers} includedPlans={includedPlans} revision={`${revision}-${refresh}`}
      onExpired={onExpired} onPlan={(start, end, ids) => open({ draft: {
        title: '', status: 'PLANNED', participants: ids.map(id => ({
          traveller_id: id, entry_date: start, exit_date: end,
          segments: [{ country_code: '', start_date: start, end_date: end }],
        })),
      } })} />
  </div>;
}
