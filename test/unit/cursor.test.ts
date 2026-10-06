import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/shared/cursor";

const key = { takenUtc: "2026-10-06T19:12:00.000Z", id: "01J9Z3K5Q8W2E4R6T8Y0V2X4Z6" };

describe("cursor", () => {
  it("round-trips and is URL-safe", () => {
    const c = encodeCursor(key);
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(c)).toEqual(key);
  });

  it("rejects garbage and malformed parts", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("!!!")).toBeNull();
    expect(decodeCursor(btoa("2026-10-06|abc"))).toBeNull();
    expect(decodeCursor(btoa(`not-a-date|${key.id}`))).toBeNull();
  });

  it("rejects ids that are not ULIDs (I, L, O and U are not Crockford base32)", () => {
    expect(decodeCursor(encodeCursor({ ...key, id: "01J9Z3K5Q8W2E4R6T8Y0U2I4O6" }))).toBeNull();
  });
});
