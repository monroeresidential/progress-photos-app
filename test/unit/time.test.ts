import { describe, expect, it } from "vitest";
import { exifToIso, parseTakenAt, toOffsetIso } from "../../src/shared/time";

describe("parseTakenAt", () => {
  it("keeps the original string and derives UTC", () => {
    expect(parseTakenAt("2026-10-06T14:12:00-05:00")).toEqual({
      takenAt: "2026-10-06T14:12:00-05:00",
      takenUtc: "2026-10-06T19:12:00.000Z",
      ms: Date.UTC(2026, 9, 6, 19, 12, 0),
    });
    expect(parseTakenAt("2026-10-06T19:12:00Z")?.takenUtc).toBe("2026-10-06T19:12:00.000Z");
  });

  it("requires an explicit offset", () => {
    expect(parseTakenAt("2026-10-06T14:12:00")).toBeNull();
    expect(parseTakenAt("yesterday")).toBeNull();
    expect(parseTakenAt("")).toBeNull();
  });
});

describe("exifToIso", () => {
  it("uses OffsetTimeOriginal when present", () => {
    expect(exifToIso("2026:10:06 14:12:00", "-05:00")).toBe("2026-10-06T14:12:00-05:00");
    expect(exifToIso("2026:10:06 14:12:00", "+02:00")).toBe("2026-10-06T14:12:00+02:00");
  });

  it("falls back to the device zone when the offset is missing (TZ=America/Chicago)", () => {
    expect(exifToIso("2026:10:06 14:12:00", null)).toBe("2026-10-06T14:12:00-05:00");
    expect(exifToIso("2026:01:15 09:00:00", null)).toBe("2026-01-15T09:00:00-06:00");
  });

  it("rejects unset or malformed dates", () => {
    expect(exifToIso("0000:00:00 00:00:00", null)).toBeNull();
    expect(exifToIso("2026-10-06 14:12:00", null)).toBeNull();
  });
});

describe("toOffsetIso", () => {
  it("formats local wall time with the local offset", () => {
    expect(toOffsetIso(new Date(Date.UTC(2026, 0, 15, 18, 0, 0)))).toBe("2026-01-15T12:00:00-06:00");
  });
});
