import { describe, expect, it } from "vitest";
import { orientedSize, readJpegMeta, readCaptureTime } from "../../src/app/lib/jpeg-meta";
import { fakeJpeg } from "./jpeg-fixture";

describe("readJpegMeta", () => {
  it("reads size, orientation and dates (little-endian EXIF)", () => {
    const meta = readJpegMeta(
      fakeJpeg({ width: 4032, height: 3024, orientation: 6, dateTimeOriginal: "2026:10:06 14:12:00", offsetTimeOriginal: "-05:00" }),
    );
    expect(meta).toEqual({ width: 4032, height: 3024, orientation: 6, dateTimeOriginal: "2026:10:06 14:12:00", offsetTimeOriginal: "-05:00" });
  });

  it("reads big-endian EXIF", () => {
    const meta = readJpegMeta(fakeJpeg({ width: 100, height: 50, orientation: 3, dateTimeOriginal: "2026:01:02 03:04:05", bigEndian: true }));
    expect(meta).toMatchObject({ orientation: 3, dateTimeOriginal: "2026:01:02 03:04:05", offsetTimeOriginal: null });
  });

  it("defaults when there is no EXIF", () => {
    expect(readJpegMeta(fakeJpeg({ width: 640, height: 480 }))).toEqual({
      width: 640, height: 480, orientation: 1, dateTimeOriginal: null, offsetTimeOriginal: null,
    });
  });

  it("returns null for non-JPEG bytes and truncated files", () => {
    expect(readJpegMeta(new TextEncoder().encode("\x89PNG....").buffer)).toBeNull();
    expect(readJpegMeta(fakeJpeg({ width: 640, height: 480 }).slice(0, 6))).toBeNull();
  });
});

describe("orientedSize", () => {
  it("swaps width and height for rotated orientations", () => {
    expect(orientedSize(4032, 3024, 1)).toEqual({ width: 4032, height: 3024 });
    expect(orientedSize(4032, 3024, 6)).toEqual({ width: 3024, height: 4032 });
    expect(orientedSize(4032, 3024, 8)).toEqual({ width: 3024, height: 4032 });
  });
});

describe("readCaptureTime", () => {
  it("reads DateTimeOriginal with its offset from just the start of the file", () => {
    const jpeg = fakeJpeg({ width: 4032, height: 3024, dateTimeOriginal: "2026:10:05 08:51:57", offsetTimeOriginal: "-05:00" });
    expect(readCaptureTime(jpeg)).toBe("2026-10-05T08:51:57-05:00");
  });

  it("returns null without EXIF or for non-JPEG bytes", () => {
    expect(readCaptureTime(fakeJpeg({ width: 10, height: 10 }))).toBeNull();
    expect(readCaptureTime(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull();
  });
});
