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
