import type { AreaCount } from "../shared/types";
import { badRequest } from "./http";

export const MAX_AREA = 40;

export function normalizeArea(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  if (t === "") return null;
  if ([...t].length > MAX_AREA) throw badRequest(`Area must be ${MAX_AREA} characters or fewer`);
  return t;
}

/** The project's areas, most-used first; hidden photos count too. */
export async function listAreas(db: D1Database, slug: string): Promise<AreaCount[]> {
  const { results } = await db
    .prepare("SELECT area, COUNT(*) AS count FROM photos WHERE project_slug = ? AND area IS NOT NULL GROUP BY area ORDER BY count DESC, area ASC LIMIT 20")
    .bind(slug)
    .all<AreaCount>();
  return results;
}
