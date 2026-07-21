// Pickup window options (docs/PRD.md §10 "Pickup time" message). Lives in the domain
// layer (not conversation/) since order creation needs it too, for the stored
// pickup_date/pickup_window fields and the COD confirmation message's time window.

export type PickupWindowId = '1' | '2' | '3' | '4' | '5';

export interface PickupWindowOption {
  id: PickupWindowId;
  // Matches the wording in the numbered PICKUP_TIME message list exactly enough to be
  // used standalone as the "[time window]" filler in the COD confirmation message.
  label: string;
  dayOffset: 0 | 1;
}

export const PICKUP_WINDOWS: PickupWindowOption[] = [
  { id: '1', label: 'today, 7AM–12PM', dayOffset: 0 },
  { id: '2', label: 'today, 12PM–4PM', dayOffset: 0 },
  { id: '3', label: 'today, 4PM–7PM', dayOffset: 0 },
  { id: '4', label: 'tomorrow morning', dayOffset: 1 },
  { id: '5', label: 'tomorrow afternoon', dayOffset: 1 },
];

export function getPickupWindowByMenuReply(reply: string): PickupWindowOption | null {
  const trimmed = reply.trim();
  return PICKUP_WINDOWS.find((window) => window.id === trimmed) ?? null;
}

// Calendar date only — pickup_date is DATE, not DATETIME (docs/DATABASE_SCHEMA.md).
// Deliberately does not validate against current time-of-day/business hours (e.g.
// picking "today morning" at 3pm) — not in Phase 3's scope, flagged as deferred.
export function resolvePickupDate(window: PickupWindowOption, now: Date = new Date()): Date {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + window.dayOffset);
  return date;
}
