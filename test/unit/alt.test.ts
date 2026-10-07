import { describe, expect, it } from "vitest";
import { photoAlt } from "../../src/shared/alt";

const at = "2026-10-05T08:52:00-05:00";

describe("photoAlt", () => {
  it("joins project, area and caption", () => {
    expect(photoAlt("Birken Lofts", { caption: "Post demolition", area: "4th floor", takenAt: at })).toBe("Birken Lofts – 4th floor – Post demolition");
  });

  it("drops missing parts", () => {
    expect(photoAlt("Birken Lofts", { caption: "4th floor demo progress", area: null, takenAt: at })).toBe("Birken Lofts – 4th floor demo progress");
    expect(photoAlt("Birken Lofts", { caption: null, area: "Lobby", takenAt: at })).toBe("Birken Lofts – Lobby");
    expect(photoAlt("Birken Lofts", { caption: "  ", area: " ", takenAt: at })).toBe("Birken Lofts construction progress, October 5, 2026");
  });

  it("skips the area when the caption already starts with it", () => {
    expect(photoAlt("Birken Lofts", { caption: "4th Floor post demolition", area: "4th floor", takenAt: at })).toBe("Birken Lofts – 4th Floor post demolition");
  });

  it("falls back to the date taken, in the photo's own offset", () => {
    expect(photoAlt("Birken Lofts", { caption: null, area: null, takenAt: "2026-10-04T23:50:00-05:00" }, "en-US")).toBe(
      "Birken Lofts construction progress, October 4, 2026",
    );
  });
});
