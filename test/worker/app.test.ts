import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { harness } from "./helpers";

describe("app", () => {
  it("returns the JSON error shape for unknown routes", async () => {
    const res = await harness().call("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found", message: "Not found" });
  });

  it("has the schema applied", async () => {
    const row = await env.DB.prepare("SELECT name FROM sqlite_master WHERE name = 'photos_feed'").first();
    expect(row).not.toBeNull();
  });
});
