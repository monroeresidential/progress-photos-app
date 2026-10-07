import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/app/api";
import { runBulk } from "../../src/app/bulk";

describe("runBulk", () => {
  it("runs at most `limit` at a time and reports progress", async () => {
    let active = 0;
    let peak = 0;
    const progress: number[] = [];
    const res = await runBulk(["a", "b", "c", "d", "e", "f"], 4, async (id) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return id.toUpperCase();
    }, (done) => progress.push(done));
    expect(peak).toBeLessThanOrEqual(4);
    expect(res.ok.map((o) => o.value).sort()).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(res.failed).toEqual([]);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("collects failures without stopping the rest", async () => {
    const res = await runBulk(["a", "b", "c"], 2, async (id) => {
      if (id === "b") throw new Error("nope");
      return id;
    });
    expect(res.ok.map((o) => o.id).sort()).toEqual(["a", "c"]);
    expect(res.failed.map((f) => f.id)).toEqual(["b"]);
  });

  it("stops starting work after a sign-in error and reports the untried ids as failed", async () => {
    const tried: string[] = [];
    const res = await runBulk(["a", "b", "c", "d"], 1, async (id) => {
      tried.push(id);
      if (id === "b") throw new ApiError(401, "signin_required", "Sign-in expired");
      return id;
    });
    expect(tried).toEqual(["a", "b"]);
    expect(res.ok.map((o) => o.id)).toEqual(["a"]);
    expect(res.failed.map((f) => f.id).sort()).toEqual(["b", "c", "d"]);
  });

  it("handles an empty selection", async () => {
    expect(await runBulk([], 4, async () => 1)).toEqual({ ok: [], failed: [] });
  });
});
