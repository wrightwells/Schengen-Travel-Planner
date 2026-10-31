import { useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { useLocalDate } from './useLocalDate';
import type { Traveller } from './api';

type CalendarDay = {
  date: string; used_days: number; remaining_days: number; status: string;
  maximum_contiguous_stay_days: number | null; history_presence: boolean; planned_presence: boolean;
  trips: { id: string; title: string; status: string; countries: string[] }[];
};
type CalendarData = { travellers: { traveller_id: string; display_name: string; days: CalendarDay[] }[] };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayMonth = (day: string) => `${day.slice(8, 10)} ${day.slice(5, 7)}`;
const fullDate = (day: string) => `${dayMonth(day)} ${day.slice(0, 4)}`;
const monthDate = (year: number, month: number, day = 1) => new Date(Date.UTC(year, month, day));
const labels: Record<string, string> = {
  AVAILABLE: 'One-day entry available', UNAVAILABLE: 'No one-day allowance', OVER_LIMIT: 'Over limit',
  UNKNOWN: 'Unknown — review history', NOT_ASSESSED: 'Not assessed — check immigration status',
  APPROACHING_LIMIT: 'Approaching limit', ASSESSED: 'Within rolling allowance',
};
function appearance(day: CalendarDay) {
  if (day.status === 'OVER_LIMIT') return 'breach';
  if (day.history_presence) return 'history';
  if (day.planned_presence) return 'plan';
  if (day.trips.length) return 'neutral';
  if (day.status === 'AVAILABLE') return 'available';
  if (day.status === 'UNAVAILABLE') return 'unavailable';
  return 'unknown';
}

function GanttCalendar({ year, people, today, selected, rangeStart, rangeEnd, onSelect }: {
  year: number; people: CalendarData['travellers']; today: string; selected: string;
  rangeStart: string; rangeEnd: string; onSelect: (day: string) => void;
}) {
  const first = monthDate(year, 0);
  const count = (monthDate(year + 1, 0).getTime() - first.getTime()) / 86400000;
  const dates = Array.from({ length: count }, (_, i) => monthDate(year, 0, i + 1));
  const position = (day: string) => Math.round((Date.parse(day) - first.getTime()) / 86400000);
  const weeks = dates.flatMap((day, i) => {
    if (i && day.getUTCDay() !== 1) return [];
    const length = Math.min(i === 0 ? (8 - day.getUTCDay()) % 7 || 7 : 7, count - i);
    return [{ start: i, length, label: dayMonth(iso(day)) }];
  });
  return <div className="gantt-calendar">
    <h3>{year} · Gantt view</h3>
    <p className="field-note" id="gantt-help">Scroll right to explore the year. Weeks start on Monday; labels show the first visible date. Trip bars show recorded travel. Select daily counts to inspect allowance or choose a date range.</p>
    <div className="gantt-scroll" role="region" aria-label="Year travel timeline" aria-describedby="gantt-help" tabIndex={0}>
      <div className="gantt-chart" style={{ width: 144 + count * 16 }}>
        <div className="gantt-row gantt-months" style={{ gridTemplateColumns: `144px repeat(${count}, 16px)` }}>
          <strong className="gantt-label">{year}</strong>
          {Array.from({ length: 12 }, (_, m) => <strong key={m} style={{ gridColumn: `${position(iso(monthDate(year, m))) + 2} / span ${monthDate(year, m + 1, 0).getUTCDate()}` }}>
            {monthDate(year, m).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })}
          </strong>)}
        </div>
        <div className="gantt-row gantt-weeks" style={{ gridTemplateColumns: `144px repeat(${count}, 16px)` }}>
          <span className="gantt-label">Week starting</span>
          {weeks.map(w => <span key={w.start} title={w.label} style={{ gridColumn: `${w.start + 2} / span ${w.length}` }}>{w.label}</span>)}
        </div>
        {people.map(person => {
          const days = new Map(person.days.map(d => [d.date, d]));
          const trips = new Map<string, { title: string; days: CalendarDay[] }>();
          person.days.forEach(day => day.trips.forEach(trip => {
            if (!trips.has(trip.id)) trips.set(trip.id, { title: trip.title, days: [] });
            trips.get(trip.id)!.days.push(day);
          }));
          return <div key={person.traveller_id} className="gantt-person">
            <div className="gantt-row gantt-counts" style={{ gridTemplateColumns: `144px repeat(${count}, 16px)` }}>
              <strong className="gantt-label">{person.display_name}<small>Days used / 90</small></strong>
              {dates.map(date => {
                const key = iso(date), day = days.get(key);
                const text = `${person.display_name}: Inspect ${fullDate(key)}${day ? `; ${day.used_days}/90 used; ${day.remaining_days} remaining; ${labels[day.status]}` : ''}`;
                return <button key={key} type="button" disabled={!day} title={text} aria-label={text}
                  aria-pressed={selected === key} onClick={() => onSelect(key)}
                  className={`gantt-day ${date.getUTCDay() === 1 ? 'week-start' : ''} ${key === today ? 'today' : ''} ${rangeStart && key >= rangeStart && key <= (rangeEnd || rangeStart) ? 'in-range' : ''}`}>
                  <span>{String(date.getUTCDate()).padStart(2, '0')}</span><span className={`calendar-marker ${day ? appearance(day) : 'unknown'}`}>{day?.used_days ?? '–'}</span>
                </button>;
              })}
            </div>
            <div className="gantt-row gantt-trip-row" style={{ gridTemplateColumns: `144px repeat(${count}, 16px)` }}>
              <span className="gantt-label">Travel</span>
              {[...trips].flatMap(([id, trip]) => {
              // Split bars at changes in presence or assessment so neutral days and breaches remain visible.
              const runs: { start: CalendarDay; end: CalendarDay; style: string }[] = [];
              trip.days.forEach(day => {
                const style = appearance(day), previous = runs.at(-1);
                if (previous && previous.style === style && position(day.date) === position(previous.end.date) + 1) previous.end = day;
                else runs.push({ start: day, end: day, style });
              });
              return runs.map(run => <button type="button" key={`${id}-${run.start.date}`}
                  className={`gantt-bar calendar-marker ${run.style}`}
                  style={{ gridColumn: `${position(run.start.date) + 2} / span ${position(run.end.date) - position(run.start.date) + 1}` }}
                  title={`${trip.title}: ${fullDate(run.start.date)} to ${fullDate(run.end.date)}`}
                  aria-label={`${person.display_name}: ${trip.title}, ${fullDate(run.start.date)} to ${fullDate(run.end.date)}; ${labels[run.start.status]}`}
                  onClick={() => onSelect(run.start.date)}>{trip.title} · {dayMonth(run.start.date)} → {dayMonth(run.end.date)}</button>);
              })}
              {!trips.size && <span className="gantt-empty" style={{ gridColumn: '2 / -1' }}>No recorded trips in this year.</span>}
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
}

export function TravelCalendar({ travellers, includedPlans, revision, onExpired, onPlan }: {
  travellers: Traveller[]; includedPlans: string[];
  revision: string; onExpired: () => void;
  onPlan: (start: string, end: string, ids: string[]) => void;
}) {
  const today = useLocalDate();
  const [month, setMonth] = useState(() => {
    try {
      const saved = localStorage.getItem('schengen-calendar-month') || '';
      if (/^\d{4}-(0[1-9]|1[0-2])$/.test(saved) && saved >= '2013-04' && saved <= '2100-12') return saved;
    } catch { /* Storage may be disabled. */ }
    return today.slice(0, 7);
  });
  const [mode, setMode] = useState(() => {
    try { const saved = localStorage.getItem('schengen-calendar-view'); return saved === 'year' || saved === 'gantt' ? saved : 'month'; }
    catch { return 'month'; }
  });
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(today);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const year = Number(month.slice(0, 4));
  const firstMonth = mode !== 'month' ? 0 : Number(month.slice(5)) - 1;
  const start = [iso(monthDate(year, firstMonth)), '2013-04-22'].sort()[1];
  const end = iso(monthDate(year, mode !== 'month' ? 12 : firstMonth + 1, 0));
  useEffect(() => {
    try { localStorage.setItem('schengen-calendar-month', month); } catch { /* Storage may be disabled. */ }
  }, [month]);
  useEffect(() => {
    try { localStorage.setItem('schengen-calendar-view', mode); } catch { /* Storage may be disabled. */ }
  }, [mode]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError('');
    const query = new URLSearchParams({ start, end, reference_date: today });
    includedPlans.forEach(id => query.append('included_plan_ids', id));
    api<CalendarData>(`/calendar?${query}`, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setData(value); }).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) onExpired();
      setError(error instanceof Error ? error.message : 'Could not load calendar.');
    });
    return () => controller.abort();
  }, [start, end, today, includedPlans, revision, retry]);
  const shown = data?.travellers.filter(t => !filter || t.traveller_id === filter) || [];
  const maps = new Map(shown.map(t => [t.traveller_id, new Map(t.days.map(d => [d.date, d]))]));
  function select(day: string) {
    setSelected(day);
    if (!rangeStart || rangeEnd) { setRangeStart(day); setRangeEnd(''); }
    else { setRangeStart(day < rangeStart ? day : rangeStart); setRangeEnd(day > rangeStart ? day : rangeStart); }
  }
  function navigate(amount: number) {
    const next = monthDate(year + (mode !== 'month' ? amount : 0), firstMonth + (mode === 'month' ? amount : 0));
    const nextMonth = mode !== 'month' && next.getUTCFullYear() === 2013 ? '2013-04' : iso(next).slice(0, 7);
    if (nextMonth >= '2013-04' && nextMonth <= '2100-12') setMonth(nextMonth);
  }
  return <section className="workspace-section travel-calendar" aria-labelledby="calendar-heading">
    <span className="eyebrow">YOUR TRAVEL AT A GLANCE</span><h2 id="calendar-heading">Travel calendar</h2>
    <p>All confirmed history and {includedPlans.length} saved plan(s) included in the scenario are shown on their dates. Use “Include in scenario” on the saved plans above to show or hide planned trips. Browse past and future dates using the month, year or horizontally scrolling Gantt view.</p>
    {!includedPlans.length && <p className="notice">Showing confirmed history only. Check “Include in scenario” on a saved plan to display its dates and allowance warnings.</p>}
    <div className="calendar-view-switch" role="group" aria-label="Calendar view">
      <button type="button" aria-pressed={mode === 'month'} onClick={() => setMode('month')}>Month view</button>
      <button type="button" aria-pressed={mode === 'year'} onClick={() => setMode('year')}>Year view</button>
      <button type="button" aria-pressed={mode === 'gantt'} onClick={() => setMode('gantt')}>Gantt view</button>
    </div>
    <div className="calendar-controls">
      {mode !== 'month' ? <label>Calendar year<select value={year} onChange={e => {
        const next = `${e.target.value}-${month.slice(5)}`;
        setMonth(next < '2013-04' ? '2013-04' : next);
      }}>{Array.from({ length: 88 }, (_, i) => <option key={i} value={2013 + i}>{2013 + i}</option>)}</select></label>
      : <label>Calendar month<input type="month" min="2013-04" max="2100-12" value={month} onChange={e => {
        if (/^\d{4}-\d{2}$/.test(e.target.value) && e.target.value >= '2013-04' && e.target.value <= '2100-12') setMonth(e.target.value);
      }} /></label>}
      <label>Calendar traveller<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">Both travellers</option>
        {travellers.map(t => <option key={t.id} value={t.id}>{t.display_name}</option>)}</select></label>
    </div>
    <div className="actions"><button className="secondary" onClick={() => navigate(-1)} disabled={year === 2013 && (mode !== 'month' || firstMonth === 3)}>Previous</button>
      <button className="secondary" onClick={() => setMonth(today.slice(0, 7))}>{mode !== 'month' ? 'This year' : 'This month'}</button>
      <button className="secondary" onClick={() => navigate(1)} disabled={year === 2100 && (mode !== 'month' || firstMonth === 11)}>Next</button></div>
    <ul className="calendar-legend" aria-label="Calendar legend">
      {[['history', 'Confirmed Schengen history'], ['plan', 'Included Schengen plan'], ['breach', 'Over limit'], ['available', 'One-day entry available'], ['unavailable', 'No one-day allowance'], ['neutral', 'Non-Schengen travel'], ['unknown', 'Unbooked / unknown']].map(([key, text]) => <li key={key}><span className={`calendar-marker ${key}`}>{text}</span></li>)}
    </ul>
    <p className="field-note">Each number is the Schengen days used in the 180-day window ending on that date, including history and selected plans. Counts may be incomplete until history is reviewed. Dark borders mark dates with recorded travel. Green means capacity for one Schengen day only; unknown or unassessed profiles never receive green availability.</p>
    {shown.length > 0 && <p className="field-note calendar-count-order">Count rows, top to bottom: {shown.map(t => t.display_name).join(' · ')}.</p>}
    {error && <div role="alert"><p className="error">{error}</p><button onClick={() => setRetry(n => n + 1)}>Retry calendar</button></div>}
    {!data && !error && <p role="status">Loading calendar…</p>}
    {data && <>
      <div className="calendar-summary" aria-label="Visible calendar warnings">{shown.map(t => {
        const breaches = t.days.filter(d => d.status === 'OVER_LIMIT');
        const unavailable = t.days.filter(d => d.status === 'UNAVAILABLE');
        return breaches.length ? <p className="notice over-limit-notice" key={t.traveller_id}><strong>{t.display_name}: Over limit</strong> on {breaches.length} date(s) shown, starting {breaches[0].date}. Red day counts identify these dates.</p>
          : unavailable.length ? <p className="notice" key={t.traveller_id}>{t.display_name}: No one-day allowance on {unavailable.length} date(s) outside selected baseline bookings. Use “Include in scenario” above to display and assess a saved plan.</p> : null;
      })}</div>
      {mode === 'year' && <h3 className="calendar-period">{year} · Year view</h3>}
      {mode === 'gantt' ? <GanttCalendar year={year} people={shown} today={today} selected={selected}
        rangeStart={rangeStart} rangeEnd={rangeEnd} onSelect={select} /> : <div className={`calendar-months ${mode}`}>
        {Array.from({ length: mode === 'year' ? 12 : 1 }, (_, i) => {
          const date = monthDate(year, firstMonth + i);
          const heading = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
          const count = monthDate(year, firstMonth + i + 1, 0).getUTCDate();
          const offset = (date.getUTCDay() + 6) % 7;
          return <div className="calendar-month" key={i}><h3>{heading}</h3><div className="calendar-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <span className="weekday" key={d}>{d}</span>)}
            {Array.from({ length: offset }, (_, n) => <span className="calendar-empty" aria-hidden="true" key={`blank${n}`} />)}
            {Array.from({ length: count }, (_, n) => {
              const day = iso(monthDate(year, firstMonth + i, n + 1));
              const hasTravel = shown.some(t => (maps.get(t.traveller_id)?.get(day)?.trips.length || 0) > 0);
              return <button key={day} disabled={day < '2013-04-22'} className={`calendar-day ${hasTravel ? 'has-travel' : ''} ${day === today ? 'today' : ''} ${rangeStart && day >= rangeStart && day <= (rangeEnd || rangeStart) ? 'in-range' : ''}`}
                aria-label={`Inspect ${day}`} aria-pressed={selected === day} onClick={() => select(day)}>
                <span>{n + 1}</span><span className="calendar-indicators">{shown.map(t => {
                  const value = maps.get(t.traveller_id)?.get(day);
                  if (!value) return null;
                  const style = appearance(value);
                  const booking = [value.history_presence && 'confirmed history', value.planned_presence && 'included plan'].filter(Boolean).join(' and ')
                    || (value.trips.length ? 'non-Schengen travel' : 'unbooked');
                  const text = `${t.display_name}: ${value.used_days} Schengen days used out of 90 in the 180 days ending ${day}; ${booking}; ${labels[value.status]}`;
                  return <span key={t.traveller_id} title={text} aria-label={text} className={`calendar-marker ${style}`}>
                    {value.used_days}
                  </span>;
                })}</span>
              </button>;
            })}
          </div></div>;
        })}
      </div>}
      <aside className="card calendar-details" aria-label="Selected calendar day" aria-live="polite"><h3>{mode === 'gantt' ? fullDate(selected) : selected}</h3>
        <p className="field-note">Count rows follow this order: {shown.map(t => t.display_name).join('; ')}.</p>
        {shown.map(t => { const day = maps.get(t.traveller_id)?.get(selected); return <div key={t.traveller_id}>
          <h4>{t.display_name}</h4>{day ? <><p>Selected baseline: {labels[day.status]} · {day.used_days}/90 used · {day.remaining_days} days remaining</p>
            {day.maximum_contiguous_stay_days !== null && <p>Maximum uninterrupted stay under the rule: {day.maximum_contiguous_stay_days} days. This measures rule capacity; check other booked destinations before planning.</p>}
            {day.trips.map(trip => <p key={trip.id}>{trip.title} · {trip.status === 'HISTORY' ? 'Confirmed history' : 'Included plan'} · {trip.countries.join(', ')}</p>)}
            {!day.trips.length && <p>No confirmed history or included plans on this date.</p>}</> : <p>Select a date in the visible calendar.</p>}
        </div>; })}
        <p>Tap a start date, then an end date to select an inclusive range. A third tap starts a new selection.</p>
        {rangeStart && <p role="status">Selected range: {mode === 'gantt' ? fullDate(rangeStart) : rangeStart} → {rangeEnd ? (mode === 'gantt' ? fullDate(rangeEnd) : rangeEnd) : 'choose an end date'}</p>}
        <div className="actions"><button disabled={!rangeEnd || !shown.length} onClick={() => onPlan(rangeStart, rangeEnd, shown.map(t => t.traveller_id))}>Plan selected dates</button>
          <button className="secondary" disabled={!rangeStart} onClick={() => { setRangeStart(''); setRangeEnd(''); }}>Clear selection</button></div>
      </aside>
    </>}
  </section>;
}
