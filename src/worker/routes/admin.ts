import { decodeCursor } from "../../shared/cursor";
import type { AdminPhoto, FeedPage, ProjectSummary } from "../../shared/types";
import { normalizeCaption } from "../captions";
import type { App, Deps } from "../env";
import { badRequest, HttpError } from "../http";
import { deletePhotoRow, getPhoto, listPhotos, photoWidths, toAdminPhoto, updatePhoto } from "../photos";
import { getProject, listProjects } from "../projects";
import { purgeUrls } from "../purge";
import { feedUrl, imageKey, imageUrl } from "../urls";

const photoNotFound = () => new HttpError(404, "not_found", "No such photo");

function parsePatch(body: unknown): { caption?: string | null; hidden?: boolean } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw badRequest("Expected a JSON object");
  const b = body as Record<string, unknown>;
  const patch: { caption?: string | null; hidden?: boolean } = {};
  if ("caption" in b) {
    if (b.caption === null) patch.caption = null;
    else if (typeof b.caption === "string") patch.caption = normalizeCaption(b.caption);
    else throw badRequest("caption must be a string or null");
  }
  if ("hidden" in b) {
    if (typeof b.hidden !== "boolean") throw badRequest("hidden must be true or false");
    patch.hidden = b.hidden;
  }
  if (patch.caption === undefined && patch.hidden === undefined) throw badRequest("Nothing to update");
  return patch;
}

export function registerAdmin(app: App, deps: Deps): void {
  app.get("/api/admin/projects", async (c) => {
    const rows = await listProjects(c.env.DB);
    return c.json(rows.map((p): ProjectSummary => ({ slug: p.slug, name: p.name, siteUrl: p.site_url })));
  });

  app.get("/api/admin/photos", async (c) => {
    const slug = c.req.query("project");
    if (!slug) throw badRequest("project is required");
    const project = await getProject(c.env.DB, slug);
    if (!project) throw new HttpError(404, "unknown_project", "No such project");
    const cursorParam = c.req.query("cursor");
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) throw new HttpError(400, "bad_cursor", "Invalid cursor");
    const { rows, nextCursor } = await listPhotos(c.env.DB, { project: slug, cursor, includeHidden: true });
    const body: FeedPage<AdminPhoto> = {
      project: { slug, name: project.name },
      photos: rows.map((r) => toAdminPhoto(r, c.env.PUBLIC_BASE_URL)),
      nextCursor,
    };
    return c.json(body);
  });

  app.patch("/api/admin/photos/:id", async (c) => {
    const patch = parsePatch(await c.req.json().catch(() => null));
    const row = await getPhoto(c.env.DB, c.req.param("id"));
    if (!row) throw photoNotFound();
    await updatePhoto(c.env.DB, row.id, patch);
    const updated = await getPhoto(c.env.DB, row.id);
    if (!updated) throw photoNotFound();
    return c.json(toAdminPhoto(updated, c.env.PUBLIC_BASE_URL));
  });

  app.delete("/api/admin/photos/:id", async (c) => {
    const row = await getPhoto(c.env.DB, c.req.param("id"));
    if (!row) throw photoNotFound();
    const widths = photoWidths(row);
    const base = c.env.PUBLIC_BASE_URL;
    await deletePhotoRow(c.env.DB, row.id);
    await c.env.PHOTOS.delete(widths.map((w) => imageKey(row.project_slug, row.id, w)));
    const purged = await purgeUrls(deps.fetch, c.env, [
      ...widths.map((w) => imageUrl(base, row.project_slug, row.id, w)),
      feedUrl(base, row.project_slug),
    ]);
    return purged ? c.body(null, 204) : c.json({ purged: false }, 200);
  });
}
