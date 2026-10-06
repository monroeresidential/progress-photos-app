import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ulid } from "../../src/worker/ulid";
import { harness } from "./helpers";

describe("GET /img/:project/:file", () => {
  it("serves the R2 object as immutable WebP", async () => {
    const id = ulid();
    await env.PHOTOS.put(`img-test/${id}-480w.webp`, new Uint8Array([1, 2, 3]));
    const res = await harness().call(`/img/img-test/${id}-480w.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("404s for a missing object", async () => {
    expect((await harness().call(`/img/img-test/${ulid()}-480w.webp`)).status).toBe(404);
  });

  it("404s for names outside the key pattern", async () => {
    expect((await harness().call("/img/img-test/..%2Fsecret")).status).toBe(404);
    expect((await harness().call("/img/IMG/whatever.webp")).status).toBe(404);
  });
});
