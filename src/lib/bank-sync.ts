/**
 * How often a book's bank connections sync. Each choice divides the day evenly,
 * starting at the book's chosen hour, so the times are easy to state. SimpleFIN
 * asks apps to stay around 24 requests a day, and manual syncs count too, so the
 * most frequent choice is every 4 hours (6 a day).
 */
export const SYNC_EVERY_HOURS = [24, 12, 6, 4, 0] as const;
export type SyncEveryHours = (typeof SYNC_EVERY_HOURS)[number];

export const SYNC_FREQUENCY_OPTIONS: { value: SyncEveryHours; label: string }[] = [
  { value: 24, label: "Once a day" },
  { value: 12, label: "Twice a day" },
  { value: 6, label: "Every 6 hours" },
  { value: 4, label: "Every 4 hours" },
  { value: 0, label: "Manually" },
];

export function isSyncEveryHours(v: unknown): v is SyncEveryHours {
  return SYNC_EVERY_HOURS.includes(v as SyncEveryHours);
}

/** The hours of the day a sync runs, earliest first. Empty when syncing is off. */
export function syncHours(everyHours: number, startHour: number): number[] {
  if (!isSyncEveryHours(everyHours) || everyHours === 0) return [];
  const hours: number[] = [];
  for (let h = startHour % everyHours; h < 24; h += everyHours) hours.push(h);
  return hours;
}

/** A cron expression for pg-boss, or null when syncing is off. */
export function syncCron(everyHours: number, startHour: number, minute: number): string | null {
  const hours = syncHours(everyHours, startHour);
  return hours.length ? `${minute} ${hours.join(",")} * * *` : null;
}

export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

function listJoin(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** A plain description, for example "every day at 6:00 AM" or "twice a day, at 6:00 AM and 6:00 PM". */
export function describeSync(everyHours: number, startHour: number): string {
  const hours = syncHours(everyHours, startHour);
  if (!hours.length) return "only when someone presses Sync now";
  const times = listJoin(hours.map(hourLabel));
  if (everyHours === 24) return `every day at ${times}`;
  if (everyHours === 12) return `twice a day, at ${times}`;
  return `every ${everyHours} hours, at ${times}`;
}
