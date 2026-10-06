import type { App, Deps } from "../env";
import { HttpError } from "../http";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE = /^[0-9A-HJKMNP-TV-Z]{26}-\d{1,5}w\.webp$/;

export function registerImages(app: App, deps: Deps): void {
  app.get("/img/:project/:file", async (c) => {
    const { project, file } = c.req.param();
    if (!SLUG.test(project) || !FILE.test(file)) throw new HttpError(404, "not_found", "No such image");

    const key = `${project}/${file}`;
    const cache = deps.cache();
    const cacheKey = new Request(`${c.env.PUBLIC_BASE_URL}/img/${key}`);
    const hit = await cache.match(cacheKey);
    if (hit) return hit;

    const obj = await c.env.PHOTOS.get(key);
    if (!obj) throw new HttpError(404, "not_found", "No such image");
    const res = new Response(obj.body, {
      headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", ETag: obj.httpEtag },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  });
}
