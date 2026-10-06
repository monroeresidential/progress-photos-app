const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

export interface TakenAt {
  takenAt: string;
  takenUtc: string;
  ms: number;
}

export function parseTakenAt(s: string): TakenAt | null {
  if (!ISO_WITH_OFFSET.test(s)) return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  return { takenAt: s, takenUtc: new Date(ms).toISOString(), ms };
}

/** EXIF "YYYY:MM:DD HH:MM:SS" (+ optional "+HH:MM") → ISO 8601 with offset. No offset → device zone. */
export function exifToIso(dateTime: string, offset: string | null): string | null {
  const m = EXIF_DATE.exec(dateTime.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  if (Number(y) < 1990) return null;
  const off = offset?.trim();
  if (off && OFFSET.test(off)) {
    const iso = `${y}-${mo}-${d}T${hh}:${mi}:${ss}${off}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss));
  return Number.isNaN(local.getTime()) ? null : toOffsetIso(local);
}

export function toOffsetIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const abs = Math.abs(off);
  const sign = off >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
