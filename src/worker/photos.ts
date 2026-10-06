import { encodeCursor, type CursorKey } from "../shared/cursor";
import type { AdminPhoto, FeedPhoto } from "../shared/types";
import { imageUrl } from "./urls";

export const PAGE_SIZE = 24;

export interface PhotoRow {
  id: string;
  project_slug: string;
  taken_at: string;
  taken_utc: string;
  uploaded_at: string;
  uploaded_by: string;
  caption: string | null;
  width: number;
  height: number;
  widths: string;
  fingerprint: string;
  hidden: number;
}

export interface NewPhoto {
  id: string;
  projectSlug: string;
  takenAt: string;
  takenUtc: string;
  uploadedAt: string;
  uploadedBy: string;
  caption: string | null;
  width: number;
  height: number;
  widths: number[];
  fingerprint: string;
}

export async function listPhotos(
  db: D1Database,
  opts: { project: string; cursor: CursorKey | null; includeHidden: boolean },
): Promise<{ rows: PhotoRow[]; nextCursor: string | null }> {
  const where = ["project_slug = ?"];
  const params: unknown[] = [opts.project];
  if (!opts.includeHidden) where.push("hidden = 0");
  if (opts.cursor) {
    where.push("(taken_utc < ? OR (taken_utc = ? AND id < ?))");
    params.push(opts.cursor.takenUtc, opts.cursor.takenUtc, opts.cursor.id);
  }
  const { results } = await db
    .prepare(`SELECT * FROM photos WHERE ${where.join(" AND ")} ORDER BY taken_utc DESC, id DESC LIMIT ?`)
    .bind(...params, PAGE_SIZE + 1)
    .all<PhotoRow>();
  const rows = results.slice(0, PAGE_SIZE);
  const last = rows[rows.length - 1];
  const nextCursor = results.length > PAGE_SIZE && last ? encodeCursor({ takenUtc: last.taken_utc, id: last.id }) : null;
  return { rows, nextCursor };
}

export async function insertPhoto(db: D1Database, p: NewPhoto): Promise<void> {
  await db
    .prepare(
      "INSERT INTO photos (id, project_slug, taken_at, taken_utc, uploaded_at, uploaded_by, caption, width, height, widths, fingerprint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(p.id, p.projectSlug, p.takenAt, p.takenUtc, p.uploadedAt, p.uploadedBy, p.caption, p.width, p.height, JSON.stringify(p.widths), p.fingerprint)
    .run();
}

export const FIND_BY_FINGERPRINT = "SELECT id FROM photos WHERE project_slug = ? AND fingerprint = ?";

export function findByFingerprint(db: D1Database, slug: string, fingerprint: string) {
  return db.prepare(FIND_BY_FINGERPRINT).bind(slug, fingerprint).first<{ id: string }>();
}

export function getPhoto(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM photos WHERE id = ?").bind(id).first<PhotoRow>();
}

export async function updatePhoto(db: D1Database, id: string, patch: { caption?: string | null; hidden?: boolean }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.caption !== undefined) {
    sets.push("caption = ?");
    params.push(patch.caption);
  }
  if (patch.hidden !== undefined) {
    sets.push("hidden = ?");
    params.push(patch.hidden ? 1 : 0);
  }
  if (sets.length === 0) return;
  await db.prepare(`UPDATE photos SET ${sets.join(", ")} WHERE id = ?`).bind(...params, id).run();
}

export async function deletePhotoRow(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
}

export function photoWidths(row: PhotoRow): number[] {
  return JSON.parse(row.widths) as number[];
}

export function toFeedPhoto(row: PhotoRow, base: string): FeedPhoto {
  return {
    id: row.id,
    takenAt: row.taken_at,
    caption: row.caption,
    width: row.width,
    height: row.height,
    srcset: Object.fromEntries(photoWidths(row).map((w) => [String(w), imageUrl(base, row.project_slug, row.id, w)])),
  };
}

export function toAdminPhoto(row: PhotoRow, base: string): AdminPhoto {
  return { ...toFeedPhoto(row, base), hidden: row.hidden === 1 };
}
