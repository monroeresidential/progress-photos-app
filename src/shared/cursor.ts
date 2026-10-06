export interface CursorKey {
  takenUtc: string;
  id: string;
}

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function encodeCursor(k: CursorKey): string {
  return btoa(`${k.takenUtc}|${k.id}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(s: string): CursorKey | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const text = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
    const [takenUtc, id, ...rest] = text.split("|");
    if (rest.length > 0 || !takenUtc || !id || !UTC.test(takenUtc) || !ULID.test(id)) return null;
    return { takenUtc, id };
  } catch {
    return null;
  }
}
