import { describe, expect, it } from "vitest";
import { findOrphans, GRACE_MS } from "../../scripts/lib/orphans.ts";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const old = new Date(NOW - GRACE_MS - 1).toISOString();
const ID_A = "01J9Z3K5Q8W2E4R6T8Y0V2X4Z6";
const ID_B = "01J9Z3K5Q8W2E4R6T8Y0V2X4Z7";

describe("findOrphans", () => {
  it("returns old keys with no matching row", () => {
    const r = findOrphans(
      [
        { key: `birken-lofts/${ID_A}-480w.webp`, uploaded: old },
        { key: `birken-lofts/${ID_B}-480w.webp`, uploaded: old },
      ],
      new Set([ID_A]),
      NOW,
    );
    expect(r).toEqual({ orphans: [`birken-lofts/${ID_B}-480w.webp`], unrecognised: [], recent: 0 });
  });

  it("skips objects younger than the grace period (upload may be in flight)", () => {
    const r = findOrphans([{ key: `birken-lofts/${ID_B}-480w.webp`, uploaded: new Date(NOW - 60_000).toISOString() }], new Set(), NOW);
    expect(r).toEqual({ orphans: [], unrecognised: [], recent: 1 });
  });

  it("treats an unparseable timestamp as recent and never deletes unrecognised keys", () => {
    const r = findOrphans(
      [
        { key: `birken-lofts/${ID_B}-480w.webp`, uploaded: "?" },
        { key: "notes.txt", uploaded: old },
      ],
      new Set(),
      NOW,
    );
    expect(r).toEqual({ orphans: [], unrecognised: ["notes.txt"], recent: 1 });
  });
});
