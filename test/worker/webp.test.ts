import { describe, expect, it } from "vitest";
import { readWebpSize } from "../../src/worker/webp";
import { fakeWebp } from "./helpers";

describe("readWebpSize", () => {
  it("reads lossy VP8 dimensions", () => {
    expect(readWebpSize(fakeWebp(1920, 1440))).toEqual({ width: 1920, height: 1440 });
  });

  it("reads VP8L (lossless) dimensions", () => {
    const b = fakeWebp(1, 1);
    b.set([0x56, 0x50, 0x38, 0x4c], 12); // "VP8L"
    b[20] = 0x2f;
    const bits = (960 - 1) | ((720 - 1) << 14);
    new DataView(b.buffer).setUint32(21, bits, true);
    expect(readWebpSize(b)).toEqual({ width: 960, height: 720 });
  });

  it("reads VP8X (extended) canvas dimensions", () => {
    const b = fakeWebp(1, 1);
    b.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
    const w = 480 - 1;
    const h = 360 - 1;
    b.set([w & 0xff, (w >> 8) & 0xff, w >> 16, h & 0xff, (h >> 8) & 0xff, h >> 16], 24);
    expect(readWebpSize(b)).toEqual({ width: 480, height: 360 });
  });

  it("rejects non-WebP bytes", () => {
    expect(readWebpSize(new TextEncoder().encode("\x89PNG\r\n\x1a\n................................"))).toBeNull();
    expect(readWebpSize(new Uint8Array(10))).toBeNull();
  });
});
