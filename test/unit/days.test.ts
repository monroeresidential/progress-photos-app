import { describe, expect, it } from "vitest";
import { dayKey, formatDay } from "../../src/embed/days";

describe("days", () => {
  it("groups by the date where the photo was taken, not the viewer's zone", () => {
    expect(dayKey("2026-10-06T23:30:00-05:00")).toBe("2026-10-06");
    expect(dayKey("2026-10-07T00:10:00+09:00")).toBe("2026-10-07");
  });

  it("formats in the requested locale without shifting the day", () => {
    expect(formatDay("2026-10-06", "en-US")).toBe("October 6, 2026");
    expect(formatDay("2026-10-06", "de-DE")).toBe("6. Oktober 2026");
  });
});
