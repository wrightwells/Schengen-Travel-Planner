import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
export type Screen = 'home' | 'history' | 'planner' | 'more';
export type PlannerView = 'trips' | 'calendar' | 'timeline';
export const formatDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
    history: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m-13 4h3m-3 3h6" /></>,
    planner: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 11h18m9 3v5m-3-2.5h6" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    arrow: <path d="m9 5 7 7-7 7" />, plus: <path d="M12 5v14M5 12h14" />,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    warning: <><path d="m12 3 10 18H2Z" /><path d="M12 9v5m0 3h.01" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m3 10v-3a6 6 0 0 0-2-4" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.globe}</svg>;
}
export function Navigation({ screen, onNavigate, view, onView }: { screen: Screen; onNavigate: (screen: Screen) => void; view: PlannerView; onView: (view: PlannerView) => void }) {
  return <nav className="app-navigation" aria-label="Main navigation"><div className="nav-caption">YOUR WORKSPACE</div>
    {(['home', 'history', 'planner', 'more'] as const).map(tab => <div key={tab} className="nav-item"><button aria-current={screen === tab ? 'page' : undefined} onClick={() => onNavigate(tab)}><Icon name={tab} /><span>{tab[0].toUpperCase() + tab.slice(1)}</span></button>
      {tab === 'planner' && screen === tab && <div className="sidebar-subnav">{(['trips', 'calendar', 'timeline'] as const).map(item => <button key={item} aria-pressed={view === item} onClick={() => onView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>}</div>)}
    <p className="nav-footnote"><Icon name="globe" size={18} />One journey at a time.<br />Your days, clearly planned.</p>
  </nav>;
}
export function Sheet({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => { const element = ref.current; element?.showModal(); return () => { element?.close(); queueMicrotask(() => { if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); }); }; }, []);
  return <dialog ref={ref} className={`sheet ${className}`} aria-labelledby={id} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="sheet-heading"><h3 id={id}>{title}</h3><button type="button" className="icon-button secondary" aria-label="Close details" onClick={onClose}><Icon name="close" /></button></div>{children}
  </dialog>;
}
