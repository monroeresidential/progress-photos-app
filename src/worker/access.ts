import type { MiddlewareHandler } from "hono";
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from "jose";
import type { AppEnv } from "./env";
import { HttpError } from "./http";

const JWKS_TTL_MS = 10 * 60 * 1000;

export type Verify = (token: string, teamDomain: string, aud: string) => Promise<string>;

export function createAccessVerifier(fetchFn: typeof fetch): Verify {
  let cached: { domain: string; at: number; keys: ReturnType<typeof createLocalJWKSet> } | null = null;

  async function keys(domain: string, force: boolean) {
    if (!force && cached && cached.domain === domain && Date.now() - cached.at < JWKS_TTL_MS) return cached.keys;
    const res = await fetchFn(`https://${domain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    cached = { domain, at: Date.now(), keys: createLocalJWKSet((await res.json()) as JSONWebKeySet) };
    return cached.keys;
  }

  return async (token, domain, aud) => {
    const opts = { audience: aud, issuer: `https://${domain}`, algorithms: ["RS256"], requiredClaims: ["exp"] };
    let payload;
    try {
      ({ payload } = await jwtVerify(token, await keys(domain, false), opts));
    } catch (err) {
      if (!(err instanceof errors.JWKSNoMatchingKey)) throw err;
      ({ payload } = await jwtVerify(token, await keys(domain, true), opts));
    }
    if (typeof payload.email !== "string" || payload.email === "") throw new Error("Access token has no email");
    return payload.email;
  };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function requireAccess(verify: Verify): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.env.DEV_AUTH_EMAIL && LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
      c.set("email", c.env.DEV_AUTH_EMAIL);
      return next();
    }
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) throw new HttpError(401, "unauthorized", "Sign in required");
    try {
      c.set("email", await verify(token, c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD));
    } catch (err) {
      console.warn("Access token rejected:", err instanceof Error ? err.message : err);
      throw new HttpError(401, "unauthorized", "Sign in required");
    }
    await next();
  };
}
