import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createApp } from "../../src/worker/app";
import type { Env } from "../../src/worker/env";

export const TEST_BASE = "https://progress.test";

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
}

export function harness(opts: HarnessOptions = {}) {
  const fetchCalls: Request[] = [];
  const upstream = async (_req: Request): Promise<Response> => new Response("unmocked", { status: 599 });
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
  return { call, fetchCalls, env: e };
}
