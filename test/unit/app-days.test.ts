import { describe, expect, it } from "vitest";
import { dayCounts, dayLabel, groupByDay, shortDayLabel, timeLabel, timeRange } from "../../src/app/days";
import type { AdminPhoto } from "../../src/shared/types";

const photo = (id: string, takenAt: string, hidden = false): AdminPhoto => ({ id, takenAt, hidden, area: null, caption: null, width: 1920, height: 1440, srcset: {} });

describe("groupByDay", () => {
  it("groups by the photo's own calendar day, newest day first", () => {
    const groups = groupByDay([
      photo("a", "2026-10-05T00:10:00-05:00"), // 05:10 UTC Oct 5, local Oct 5
      photo("b", "2026-10-04T23:50:00-05:00"), // 04:50 UTC Oct 5, but local Oct 4
      photo("c", "2026-10-05T08:52:00-05:00"),
    ]);
    expect(groups.map((g) => [g.key, g.photos.map((p) => p.id)])).toEqual([
      ["2026-10-05", ["a", "c"]],
      ["2026-10-04", ["b"]],
    ]);
  });
});

describe("labels", () => {
  it("formats days", () => {
    expect(dayLabel("2026-10-05", "en-US")).toBe("Monday, October 5");
    expect(shortDayLabel("2026-10-05", "en-US")).toBe("Monday, Oct 5");
  });

  it("counts photos and live ones", () => {
    expect(dayCounts([photo("a", "2026-10-05T08:00:00-05:00"), photo("b", "2026-10-05T09:00:00-05:00", true)])).toBe("2 photos · 1 live");
    expect(dayCounts([photo("a", "2026-10-05T08:00:00-05:00")])).toBe("1 photo · 1 live");
  });

  it("formats the wall-clock time from the photo's own offset", () => {
    expect(timeLabel("2026-10-05T08:52:07-05:00")).toBe("8:52 AM");
    expect(timeLabel("2026-10-05T08:51:57-05:00", true)).toBe("8:51:57 AM");
    expect(timeLabel("2026-10-05T00:05:00+02:00")).toBe("12:05 AM");
    expect(timeLabel("2026-10-05T12:30:00-05:00")).toBe("12:30 PM");
  });
});

describe("timeRange", () => {
  it("handles one time, one day, and several days", () => {
    expect(timeRange([], "en-US")).toBe("");
    expect(timeRange(["2026-10-05T08:51:00-05:00"], "en-US")).toBe("Oct 5, 8:51 AM");
    expect(timeRange(["2026-10-05T08:52:00-05:00", "2026-10-05T08:51:00-05:00"], "en-US")).toBe("Oct 5, 8:51–8:52 AM");
    expect(timeRange(["2026-10-05T11:50:00-05:00", "2026-10-05T12:10:00-05:00"], "en-US")).toBe("Oct 5, 11:50 AM–12:10 PM");
    expect(timeRange(["2026-10-04T09:10:00-05:00", "2026-10-05T08:52:00-05:00"], "en-US")).toBe("Oct 4, 9:10 AM – Oct 5, 8:52 AM");
  });
});
