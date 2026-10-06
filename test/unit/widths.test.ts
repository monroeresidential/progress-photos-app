import { describe, expect, it } from "vitest";
import { maxBytesFor, scaledHeight, selectWidths } from "../../src/shared/widths";

describe("selectWidths", () => {
  it("keeps every standard width at or below the original", () => {
    expect(selectWidths(4032)).toEqual([480, 960, 1920]);
    expect(selectWidths(1920)).toEqual([480, 960, 1920]);
    expect(selectWidths(1500)).toEqual([480, 960]);
    expect(selectWidths(480)).toEqual([480]);
  });

  it("stores a sub-480 original once at its own width", () => {
    expect(selectWidths(400)).toEqual([400]);
  });
});

describe("maxBytesFor", () => {
  it("uses the spec limits in KiB, and the 480 limit for small originals", () => {
    expect(maxBytesFor(480)).toBe(150 * 1024);
    expect(maxBytesFor(960)).toBe(500 * 1024);
    expect(maxBytesFor(1920)).toBe(1536 * 1024);
    expect(maxBytesFor(400)).toBe(150 * 1024);
  });
});

describe("scaledHeight", () => {
  it("keeps the aspect ratio and rounds", () => {
    expect(scaledHeight(480, 1920, 1440)).toBe(360);
    expect(scaledHeight(480, 1920, 2560)).toBe(640);
    expect(scaledHeight(960, 1920, 1081)).toBe(541);
  });
});
