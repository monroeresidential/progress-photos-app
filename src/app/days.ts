import { dayKey } from "../embed/days";
import type { AdminPhoto } from "../shared/types";

export { dayKey };

export interface DayGroup {
  key: string;
  photos: AdminPhoto[];
}

/** Groups by the calendar day in each photo's own offset; newest day first, order within a day kept. */
export function groupByDay(photos: AdminPhoto[]): DayGroup[] {
  const groups = new Map<string, AdminPhoto[]>();
  for (const p of photos) {
    const key = dayKey(p.takenAt);
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  return [...groups].map(([key, list]) => ({ key, photos: list })).sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

const asUtcDate = (key: string) => new Date(`${key}T00:00:00Z`);

export function dayLabel(key: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(asUtcDate(key));
}

export function shortDayLabel(key: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(asUtcDate(key));
}

function monthDay(key: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }).format(asUtcDate(key));
}

export function dayCounts(photos: { hidden: boolean }[]): string {
  const live = photos.filter((p) => !p.hidden).length;
  return `${photos.length} ${photos.length === 1 ? "photo" : "photos"} · ${live} live`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hourOf = (takenAt: string) => Number(takenAt.slice(11, 13));
const meridiem = (h: number) => (h < 12 ? "AM" : "PM");

/** Wall-clock time where the photo was taken (from the offset in takenAt, not the viewer's zone). */
export function timeLabel(takenAt: string, withSeconds = false): string {
  const h = hourOf(takenAt);
  const m = Number(takenAt.slice(14, 16));
  const s = Number(takenAt.slice(17, 19)) || 0;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(m)}${withSeconds ? `:${pad(s)}` : ""} ${meridiem(h)}`;
}

export function timeRange(takenAts: string[], locale?: string): string {
  if (takenAts.length === 0) return "";
  const sorted = [...takenAts].sort((a, b) => Date.parse(a) - Date.parse(b));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const d1 = dayKey(first);
  const d2 = dayKey(last);
  const t1 = timeLabel(first);
  const t2 = timeLabel(last);
  if (d1 !== d2) return `${monthDay(d1, locale)}, ${t1} – ${monthDay(d2, locale)}, ${t2}`;
  if (t1 === t2) return `${monthDay(d1, locale)}, ${t1}`;
  const left = meridiem(hourOf(first)) === meridiem(hourOf(last)) ? t1.replace(/ [AP]M$/, "") : t1;
  return `${monthDay(d1, locale)}, ${left}–${t2}`;
}
