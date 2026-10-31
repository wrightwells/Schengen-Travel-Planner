export type Traveller = {
  id: string;
  display_name: string;
  rule_applicable: boolean | null;
  history_complete: boolean;
  history_reviewed_on: string | null;
  notes: string;
  version: number;
};

export type Country = { code: string; name: string; note: string; memberships: {
  effective_from: string; effective_to: string | null; is_schengen: boolean;
}[] };
export type Segment = { country_code: string; start_date: string; end_date: string; country_name?: string };
export type Participant = { traveller_id: string; entry_date: string; exit_date: string; segments: Segment[] };
export type TripDraft = { title: string; status: 'HISTORY' | 'PLANNED'; participants: Participant[] };
export type Trip = Omit<TripDraft, 'participants'> & { id: string; version: number; participants: (Participant & { schengen_days: number })[] };
export type PersonSummary = { traveller_id: string; used_days: number; remaining_days: number;
  status: string; history_complete: boolean; history_reviewed_on: string | null };
export type Summary = { reference_date: string; window_start: string; baseline: string; travellers: PersonSummary[] };
export type Assessment = { traveller_id: string; display_name: string; status: string;
  first_breach_date: string | null; peak_rolling_days: number; remaining_at_entry: number;
  remaining_at_exit: number; maximum_contiguous_stay_days: number | null;
  earliest_one_day_entry: string | null; earliest_full_trip_entry: string | null;
  search_end_date: string; excess_days: number; warnings: string[] };

export function localDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}, csrf?: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'SchengenPlanner',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = body.detail;
    const message = typeof detail === 'string' ? detail : detail?.message;
    throw new ApiError(response.status, message || `Request failed (${response.status}). Please retry.`);
  }
  return response.status === 204 ? undefined as T : response.json();
}
