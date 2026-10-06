/** Calendar day at the site where the photo was taken (from the offset in takenAt). */
export function dayKey(takenAt: string): string {
  return takenAt.slice(0, 10);
}

export function formatDay(key: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));
}
