import type { Hono } from "hono";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  PUBLIC_BASE_URL: string;
  CF_ZONE_ID: string;
  CF_PURGE_TOKEN?: string;
  DEV_AUTH_EMAIL?: string;
}

/** Everything the app reaches outside its bindings, injected so tests can fake it. */
export interface Deps {
  fetch: typeof fetch;
  cache: () => Cache;
  now: () => number;
}

export type AppEnv = { Bindings: Env; Variables: { email: string } };
export type App = Hono<AppEnv>;
