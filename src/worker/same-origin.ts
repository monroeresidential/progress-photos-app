import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";
import { HttpError } from "./http";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Refuses state-changing requests that the browser marks as cross-origin (CSRF defence). */
export function requireSameOrigin(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!SAFE.has(c.req.method)) {
      const origin = c.req.header("Origin");
      const site = c.req.header("Sec-Fetch-Site");
      if ((origin !== undefined && origin !== new URL(c.req.url).origin) || site === "cross-site" || site === "same-site") {
        throw new HttpError(403, "cross_origin", "Cross-origin request refused");
      }
    }
    await next();
  };
}
