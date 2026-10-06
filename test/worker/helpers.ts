import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createApp } from "../../src/worker/app";
import type { Env } from "../../src/worker/env";

export const TEST_BASE = "https://progress.test";

export const TEAM = "team.cloudflareaccess.com";
export const JWKS_URL = `https://${TEAM}/cdn-cgi/access/certs`;

const signing = await generateKeyPair("RS256", { extractable: true });
export const publicJwk: JWK = { ...(await exportJWK(signing.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

export async function accessToken(o: {
  email?: string | null;
  aud?: string;
  iss?: string;
  exp?: number | null;
  key?: CryptoKey;
  kid?: string;
} = {}): Promise<string> {
  const claims: Record<string, unknown> = {};
  if (o.email !== null) claims.email = o.email ?? "uploader@example.com";
  let jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: o.kid ?? "k1" })
    .setIssuer(o.iss ?? `https://${TEAM}`)
    .setAudience(o.aud ?? "test-aud")
    .setIssuedAt();
  if (o.exp !== null) jwt = jwt.setExpirationTime(o.exp ?? Math.floor(Date.now() / 1000) + 600);
  return jwt.sign(o.key ?? signing.privateKey);
}

export const noCache = {
  match: async () => undefined,
  put: async () => {},
  delete: async () => false,
} as unknown as Cache;

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...(env as unknown as Env),
    ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    ACCESS_AUD: "test-aud",
    PUBLIC_BASE_URL: TEST_BASE,
    CF_ZONE_ID: "zone123",
    CF_PURGE_TOKEN: undefined,
    DEV_AUTH_EMAIL: undefined,
    ...overrides,
  };
}

export interface HarnessOptions {
  env?: Partial<Env>;
  cache?: Cache;
  now?: number;
  jwks?: JWK[];
}

export function harness(opts: HarnessOptions = {}) {
  const fetchCalls: Request[] = [];
  const upstream = async (req: Request): Promise<Response> => {
    if (req.url === JWKS_URL) return Response.json({ keys: opts.jwks ?? [publicJwk] });
    return new Response("unmocked", { status: 599 });
  };
  const app = createApp({
    fetch: async (input, init) => {
      const req = new Request(input, init);
      fetchCalls.push(req.clone());
      return upstream(req);
    },
    cache: () => opts.cache ?? noCache,
    now: () => opts.now ?? Date.now(),
  });
  const e = testEnv(opts.env);
  const call = async (path: string, init?: RequestInit, base = TEST_BASE) =>
    app.fetch(new Request(base + path, init), e, createExecutionContext());
  const admin = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Cf-Access-Jwt-Assertion", await accessToken());
    return call(path, { ...init, headers });
  };
  return { call, admin, fetchCalls, env: e };
}
