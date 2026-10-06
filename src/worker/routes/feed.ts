import { decodeCursor } from "../../shared/cursor";
import type { FeedPage } from "../../shared/types";
import type { App, Deps } from "../env";
import { HttpError } from "../http";
import { listPhotos, toFeedPhoto } from "../photos";
import { allowedOrigins, getProject } from "../projects";
import { feedUrl } from "../urls";

export function registerFeed(app: App, deps: Deps): void {
  app.get("/api/feed/:project", async (c) => {
    const project = await getProject(c.env.DB, c.req.param("project"));
    if (!project) throw new HttpError(404, "unknown_project", "No such project");

    const cursorParam = c.req.query("cursor");
    const cursor = cursorParam === undefined ? null : decodeCursor(cursorParam);
    if (cursorParam !== undefined && !cursor) throw new HttpError(400, "bad_cursor", "Invalid cursor");

    // Cached body is origin-independent; CORS is applied per request below.
    const cache = deps.cache();
    const cacheKey = new Request(feedUrl(c.env.PUBLIC_BASE_URL, project.slug, cursorParam));
    let res = await cache.match(cacheKey);
    if (!res) {
      const { rows, nextCursor } = await listPhotos(c.env.DB, { project: project.slug, cursor, includeHidden: false });
      const body: FeedPage = {
        project: { slug: project.slug, name: project.name },
        photos: rows.map((r) => toFeedPhoto(r, c.env.PUBLIC_BASE_URL)),
        nextCursor,
      };
      res = Response.json(body, { headers: { "Cache-Control": "public, max-age=60" } });
      c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    }

    const out = new Response(res.body, res);
    out.headers.set("Vary", "Origin");
    const origin = c.req.header("Origin");
    if (origin && allowedOrigins(project).includes(origin)) out.headers.set("Access-Control-Allow-Origin", origin);
    return out;
  });
}
