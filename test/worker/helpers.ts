import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { createApp } from "../../src/worker/app";
import type { FeedPage } from "../../src/shared/types";
import type { Env } from "../../src/worker/env";
import { ulid } from "../../src/worker/ulid";

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

export function randomHex(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function seedProject(o: { origins?: string[]; name?: string } = {}): Promise<string> {
  const slug = `p-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO projects (slug, name, site_url, allowed_origins, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(slug, o.name ?? `Project ${slug}`, `https://${slug}.example/progress/`, JSON.stringify(o.origins ?? ["https://site.example"]), new Date().toISOString())
    .run();
  return slug;
}

export async function seedPhoto(
  slug: string,
  o: { id?: string; takenAt?: string; hidden?: boolean; caption?: string | null; fingerprint?: string; widths?: number[] } = {},
): Promise<string> {
  const id = o.id ?? ulid();
  const takenAt = o.takenAt ?? "2026-10-01T12:00:00-05:00";
  await env.DB.prepare(
    "INSERT INTO photos (id, project_slug, taken_at, taken_utc, uploaded_at, uploaded_by, caption, width, height, widths, fingerprint, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, slug, takenAt, new Date(takenAt).toISOString(), new Date().toISOString(), "seed@example.com", o.caption ?? null, 1920, 1440, JSON.stringify(o.widths ?? [480, 960, 1920]), o.fingerprint ?? randomHex(), o.hidden ? 1 : 0)
    .run();
  return id;
}

export async function allFeedPages(call: (path: string) => Promise<Response>, path: string): Promise<FeedPage[]> {
  const pages: FeedPage[] = [];
  let cursor: string | null = null;
  do {
    const res = await call(cursor ? `${path}${path.includes("?") ? "&" : "?"}cursor=${cursor}` : path);
    const page = (await res.json()) as FeedPage;
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor);
  return pages;
}

/** Minimal lossy-WebP ("VP8 ") header of the given size, zero-padded to `totalBytes`. */
export function fakeWebp(width: number, height: number, totalBytes = 64): Uint8Array {
  const b = new Uint8Array(Math.max(totalBytes, 30));
  const dv = new DataView(b.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((ch, i) => (b[o + i] = ch.charCodeAt(0)));
  ascii(0, "RIFF");
  dv.setUint32(4, b.length - 8, true);
  ascii(8, "WEBP");
  ascii(12, "VP8 ");
  dv.setUint32(16, b.length - 20, true);
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  dv.setUint16(26, width & 0x3fff, true);
  dv.setUint16(28, height & 0x3fff, true);
  return b;
}

export function uploadForm(o: {
  project: string;
  fingerprint?: string;
  takenAt?: string;
  caption?: string;
  width?: number;
  height?: number;
  files?: Record<string, Uint8Array>;
}): FormData {
  const width = o.width ?? 1920;
  const height = o.height ?? 1440;
  const files = o.files ?? { w480: fakeWebp(480, 360), w960: fakeWebp(960, 720), w1920: fakeWebp(1920, 1440) };
  const f = new FormData();
  f.set("project", o.project);
  f.set("fingerprint", o.fingerprint ?? randomHex());
  f.set("takenAt", o.takenAt ?? "2026-10-06T14:12:00-05:00");
  if (o.caption !== undefined) f.set("caption", o.caption);
  f.set("width", String(width));
  f.set("height", String(height));
  for (const [name, bytes] of Object.entries(files)) f.set(name, new File([bytes], `${name}.webp`, { type: "image/webp" }));
  return f;
}

export async function listKeys(prefix: string): Promise<string[]> {
  return (await env.PHOTOS.list({ prefix })).objects.map((o) => o.key).sort();
}
