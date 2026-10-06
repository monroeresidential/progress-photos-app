export interface StoredObject {
  key: string;
  uploaded: string;
}

/** An upload writes R2 before D1; anything this young may still be mid-upload. */
export const GRACE_MS = 60 * 60 * 1000;

const KEY = /^[a-z0-9-]+\/([0-9A-HJKMNP-TV-Z]{26})-\d+w\.webp$/;

export function findOrphans(objects: StoredObject[], photoIds: Set<string>, now: number) {
  const orphans: string[] = [];
  const unrecognised: string[] = [];
  let recent = 0;
  for (const o of objects) {
    const m = KEY.exec(o.key);
    if (!m) {
      unrecognised.push(o.key);
      continue;
    }
    if (photoIds.has(m[1]!)) continue;
    const age = now - Date.parse(o.uploaded);
    if (!(age >= GRACE_MS)) {
      recent++;
      continue;
    }
    orphans.push(o.key);
  }
  return { orphans, unrecognised, recent };
}

/** Recognised image keys at least GRACE_MS old, whether or not a row exists. */
export function countRecognisedOld(objects: StoredObject[], now: number): number {
  return objects.filter((o) => KEY.test(o.key) && now - Date.parse(o.uploaded) >= GRACE_MS).length;
}

/**
 * Returns a refusal message when the orphan list looks like a D1 problem (wrong or empty
 * database) rather than real orphans, or null when it is plausible. R2 deletes cannot be undone.
 */
export function orphanSafetyCheck(a: { recognisedOld: number; orphans: string[]; photoIds: Set<string> }): string | null {
  if (a.recognisedOld === 0) return null;
  if (a.photoIds.size === 0) {
    return "D1 returned no rows from photos, but the bucket holds image objects. Wrong database_id or an empty restore? Refusing to treat them all as orphans.";
  }
  if (a.orphans.length === a.recognisedOld) {
    return `Every one of the ${a.recognisedOld} image objects older than the grace period would be deleted. That points at a database mismatch, not orphans. Refusing.`;
  }
  return null;
}
