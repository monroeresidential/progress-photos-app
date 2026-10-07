import { parseTakenAt } from "../../shared/time";
import { maxBytesFor, scaledHeight, selectWidths } from "../../shared/widths";
import { normalizeArea } from "../areas";
import { normalizeCaption } from "../captions";
import type { App, Deps } from "../env";
import { badRequest, HttpError } from "../http";
import { findByFingerprint, insertPhoto } from "../photos";
import { getProject } from "../projects";
import { ulid } from "../ulid";
import { purgeUrls } from "../purge";
import { feedUrl, imageKey } from "../urls";
import { readWebpSize } from "../webp";

const DAY_MS = 24 * 60 * 60 * 1000;
const FINGERPRINT = /^[0-9a-f]{64}$/;

export function registerUpload(app: App, deps: Deps): void {
  app.post("/api/admin/photos", async (c) => {
    const form = await c.req.raw.formData().catch(() => {
      throw badRequest("Expected multipart/form-data");
    });
    const field = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : null;
    };

    const slug = field("project");
    if (!slug) throw badRequest("project is required");
    const project = await getProject(c.env.DB, slug);
    if (!project) throw new HttpError(404, "unknown_project", "No such project");

    const fingerprint = field("fingerprint");
    if (!fingerprint || !FINGERPRINT.test(fingerprint)) throw badRequest("fingerprint must be 64 lowercase hex characters");

    const taken = parseTakenAt(field("takenAt") ?? "");
    if (!taken) throw badRequest("takenAt must be ISO 8601 with a time zone offset");
    const now = deps.now();
    if (taken.ms > now + DAY_MS) throw badRequest("takenAt is in the future");

    const caption = normalizeCaption(field("caption") ?? "");
    const area = normalizeArea(field("area"));

    const width = Number(field("width"));
    const height = Number(field("height"));
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw badRequest("width and height must be positive integers");
    }
    const widths = selectWidths(width);
    if (widths[widths.length - 1] !== width) throw badRequest("width must be 480, 960, 1920, or an original narrower than 480");

    const expectedFields = new Set(widths.map((w) => `w${w}`));
    for (const key of form.keys()) {
      if (/^w\d+$/.test(key) && !expectedFields.has(key)) throw badRequest(`Unexpected file ${key}`);
    }

    const existing = await findByFingerprint(c.env.DB, slug, fingerprint);
    if (existing) return c.json({ id: existing.id, duplicate: true }, 200);

    const files: { width: number; bytes: Uint8Array }[] = [];
    for (const w of widths) {
      const file = form.get(`w${w}`);
      if (!(file instanceof File)) throw badRequest(`Missing file w${w}`);
      if (file.size > maxBytesFor(w)) throw new HttpError(413, "too_large", `w${w} is ${file.size} bytes; the limit is ${maxBytesFor(w)}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const size = readWebpSize(bytes);
      if (!size) throw badRequest(`w${w} is not a WebP image`);
      const expectedHeight = w === width ? height : scaledHeight(w, width, height);
      if (size.width !== w || Math.abs(size.height - expectedHeight) > 1) {
        throw badRequest(`w${w} is ${size.width}×${size.height}; expected ${w}×${expectedHeight}`);
      }
      files.push({ width: w, bytes });
    }

    const id = ulid(now);
    const keys = files.map((f) => imageKey(slug, id, f.width));
    // The edge may hold the first feed page for a minute; drop it so the new photo shows up.
    const created = () => {
      c.executionCtx.waitUntil(purgeUrls(deps.fetch, c.env, [feedUrl(c.env.PUBLIC_BASE_URL, slug)]));
      return c.json({ id }, 201);
    };
    const cleanup = async () => {
      try {
        await c.env.PHOTOS.delete(keys);
      } catch (e) {
        console.error("R2 cleanup failed", e);
      }
    };
    try {
      const puts = await Promise.allSettled(files.map((f, i) => c.env.PHOTOS.put(keys[i]!, f.bytes, { httpMetadata: { contentType: "image/webp" } })));
      const failed = puts.find((p): p is PromiseRejectedResult => p.status === "rejected");
      if (failed) throw failed.reason;
      await insertPhoto(c.env.DB, {
        id,
        projectSlug: slug,
        takenAt: taken.takenAt,
        takenUtc: taken.takenUtc,
        uploadedAt: new Date(now).toISOString(),
        uploadedBy: c.var.email,
        caption,
        width,
        height,
        widths,
        fingerprint,
        area,
      });
    } catch (err) {
      let dup: { id: string } | null;
      try {
        dup = await findByFingerprint(c.env.DB, slug, fingerprint);
      } catch (lookupErr) {
        // Can't tell whether the row committed; an orphaned object is safer than a row with missing images.
        console.error("Fingerprint lookup failed after upload error", lookupErr);
        throw err;
      }
      // The insert may have committed even though the call failed: keep our own images.
      if (dup?.id === id) return created();
      await cleanup();
      if (dup) return c.json({ id: dup.id, duplicate: true }, 200);
      throw err;
    }
    return created();
  });
}
