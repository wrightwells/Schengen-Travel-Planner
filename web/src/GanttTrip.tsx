import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { Participant, Trip } from './api';

type Edge = 'start' | 'end';
type Run = { start: string; end: string; style: string; label: string };
const dayMs = 86400000;
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
const display = (date: string) => `${date.slice(8)} ${date.slice(5, 7)}`;
const fullDate = (date: string) => `${display(date)} ${date.slice(0, 4)}`;

export function GanttTrip({ trip, participant, name, year, runs, disabled, onSelect, onResize }: {
  trip: Trip; participant: Participant; name: string; year: number; runs: Run[]; disabled: boolean;
  onSelect: (date: string) => void;
  onResize: (trip: Trip, travellerId: string, edge: Edge, date: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<{ edge: Edge; date: string } | null>(null);
  const drag = useRef<{ edge: Edge; x: number; scroll: number; pointerX: number; date: string;
    original: string; moved: boolean; scroller: HTMLElement; pointerId: number; handle: HTMLButtonElement } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const lower = `${year}-01-01`, upper = `${year}-12-31`;
  const start = preview?.edge === 'start' ? preview.date : participant.entry_date;
  const end = preview?.edge === 'end' ? preview.date : participant.exit_date;
  const position = (date: string) => Math.round((Date.parse(date) - Date.parse(lower)) / dayMs);
  const clamp = (edge: Edge, date: string) => {
    const minimum = edge === 'start' ? '2013-04-22' : participant.entry_date;
    const maximum = edge === 'start' ? participant.exit_date : '2100-12-31';
    return date < minimum ? minimum : date > maximum ? maximum : date;
  };
  function update() {
    const current = drag.current;
    if (!current) return;
    const date = clamp(current.edge, shift(current.original,
      Math.round((current.pointerX - current.x + current.scroller.scrollLeft - current.scroll) / 16)));
    if (date !== current.date) {
      current.date = date;
      setPreview({ edge: current.edge, date });
    }
  }
  function cancel() {
    const current = drag.current;
    drag.current = null;
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    setDragging(false); setPreview(null);
  }
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    function scroll() {
      const current = drag.current;
      if (!current) return;
      if (!current.moved) { frame = requestAnimationFrame(scroll); return; }
      const bounds = current.scroller.getBoundingClientRect();
      // Leave room for the sticky traveller label when scrolling towards January.
      const left = bounds.left + 144;
      const amount = current.pointerX < left + 24 ? -8 : current.pointerX > bounds.right - 24 ? 8 : 0;
      if (amount) { current.scroller.scrollLeft += amount; update(); }
      frame = requestAnimationFrame(scroll);
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    frame = requestAnimationFrame(scroll);
    window.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', escape); };
  }, [dragging]);
  async function save(edge: Edge, date: string) {
    if (date === (edge === 'start' ? participant.entry_date : participant.exit_date)) { setPreview(null); return; }
    setPending(true);
    try { await onResize(trip, participant.traveller_id, edge, date); }
    finally { setPending(false); setPreview(null); }
  }
  function begin(event: PointerEvent<HTMLButtonElement>, edge: Edge) {
    if (event.button !== 0 || disabled || pending) return;
    const scroller = event.currentTarget.closest<HTMLElement>('.gantt-scroll');
    if (!scroller) return;
    event.preventDefault(); event.stopPropagation();
    const original = edge === 'start' ? participant.entry_date : participant.exit_date;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { edge, x: event.clientX, pointerX: event.clientX, scroll: scroller.scrollLeft,
      original, date: original, moved: false, scroller, pointerId: event.pointerId, handle: event.currentTarget };
    setPreview({ edge, date: original }); setDragging(true);
  }
  const visibleStart = start < lower ? lower : start > upper ? upper : start;
  const visibleEnd = end > upper ? upper : end < lower ? lower : end;
  return <div className={`gantt-trip ${preview ? 'gantt-resizing' : ''}`} aria-busy={pending}
    style={{ gridColumn: `${position(visibleStart) + 2} / span ${position(visibleEnd) - position(visibleStart) + 1}` }}>
    {preview ? <span className="gantt-bar gantt-preview">{trip.title} · {display(start)} → {display(end)}</span>
      : runs.map(run => <button type="button" key={run.start} className={`gantt-bar calendar-marker ${run.style}`}
        style={{ flex: 'none', width: `${100 * (position(run.end) - position(run.start) + 1) / (position(visibleEnd) - position(visibleStart) + 1)}%` }}
        title={`${trip.title}: ${fullDate(run.start)} to ${fullDate(run.end)}`}
        aria-label={`${name}: ${trip.title}, ${fullDate(run.start)} to ${fullDate(run.end)}; ${run.label}`}
        onClick={() => onSelect(run.start)}><span className="gantt-bar-label">{trip.title} · {display(run.start)} → {display(run.end)}</span></button>)}
    {(['start', 'end'] as const).map(edge => {
      const original = edge === 'start' ? participant.entry_date : participant.exit_date;
      if (original < lower || original > upper) return null;
      return <button key={edge} type="button" className={`gantt-resize-handle ${edge}`}
        aria-label={`${name}: Change ${edge} of ${trip.title}`} aria-describedby="gantt-help"
        title={`Drag ${edge} date (${original}), or use Left and Right arrow keys`}
        disabled={disabled || pending} onPointerDown={event => begin(event, edge)}
        onPointerMove={event => { if (drag.current?.pointerId === event.pointerId) { drag.current.pointerX = event.clientX; drag.current.moved ||= Math.abs(event.clientX - drag.current.x) >= 3; update(); } }}
        onPointerUp={event => {
          const current = drag.current;
          if (!current || current.pointerId !== event.pointerId) return;
          current.pointerX = event.clientX; update();
          drag.current = null; setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          void save(current.edge, current.date);
        }} onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }}
        onKeyDown={event => {
          if (event.key === 'Escape') { cancel(); return; }
          if (drag.current || disabled || pending || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          const date = clamp(edge, shift(original, event.key === 'ArrowLeft' ? -1 : 1));
          setPreview({ edge, date }); void save(edge, date);
        }}><span aria-hidden="true">⋮</span></button>;
    })}
    {preview && <span className="gantt-resize-dates" role="status">{fullDate(start)} → {fullDate(end)}{pending ? ' · Saving…' : ''}</span>}
  </div>;
}
