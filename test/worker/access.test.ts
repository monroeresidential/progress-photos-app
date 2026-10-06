import { generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import { accessToken, harness, JWKS_URL } from "./helpers";

const withToken = (token: string) => ({ headers: { "Cf-Access-Jwt-Assertion": token } });

describe("Access verification on /api/admin/*", () => {
  it("rejects a missing token", async () => {
    const res = await harness().call("/api/admin/whoami");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
  });

  it.each([
    ["garbage", () => Promise.resolve("not.a.jwt")],
    ["wrong audience", () => accessToken({ aud: "other-app" })],
    ["wrong issuer", () => accessToken({ iss: "https://evil.cloudflareaccess.com" })],
    ["expired", () => accessToken({ exp: Math.floor(Date.now() / 1000) - 60 })],
    ["no expiry", () => accessToken({ exp: null })],
    ["no email", () => accessToken({ email: null })],
  ])("rejects a token with %s", async (_name, make) => {
    const res = await harness().call("/api/admin/whoami", withToken(await make()));
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and exposes the email", async () => {
    const res = await harness().call("/api/admin/whoami", withToken(await accessToken()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "uploader@example.com" });
  });

  it("caches the JWKS between requests", async () => {
    const h = harness();
    await h.call("/api/admin/whoami", withToken(await accessToken()));
    await h.call("/api/admin/whoami", withToken(await accessToken()));
    expect(h.fetchCalls.filter((r) => r.url === JWKS_URL)).toHaveLength(1);
  });

  it("refetches the JWKS once for an unknown kid, then rejects", async () => {
    const other = await generateKeyPair("RS256", { extractable: true });
    const h = harness(); // JWKS only has k1; the token below is signed by an unknown key "k2"
    await h.call("/api/admin/whoami", withToken(await accessToken()));
    const res = await h.call("/api/admin/whoami", withToken(await accessToken({ key: other.privateKey, kid: "k2" })));
    expect(res.status).toBe(401);
    expect(h.fetchCalls.filter((r) => r.url === JWKS_URL)).toHaveLength(2);
  });

  it("honors DEV_AUTH_EMAIL only on localhost", async () => {
    const h = harness({ env: { DEV_AUTH_EMAIL: "dev@example.com" } });
    expect((await h.call("/api/admin/whoami")).status).toBe(401);
    const local = await h.call("/api/admin/whoami", undefined, "http://localhost:8787");
    expect(local.status).toBe(200);
    expect(await local.json()).toEqual({ email: "dev@example.com" });
  });

  it("marks admin responses no-store", async () => {
    const res = await harness().call("/api/admin/whoami", withToken(await accessToken()));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
