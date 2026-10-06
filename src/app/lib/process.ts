import encodeWebp from "@jsquash/webp/encode";
import { exifToIso, toOffsetIso } from "../../shared/time";
import { maxBytesFor, scaledHeight, selectWidths } from "../../shared/widths";
import { orientedSize, readJpegMeta } from "./jpeg-meta";

export interface Processed {
  fingerprint: string;
  takenAt: string;
  width: number;
  height: number;
  variants: { width: number; blob: Blob }[];
}

export class UnreadablePhotoError extends Error {}

const QUALITIES = [80, 70, 60, 50];

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function decodeUpright(file: File, width: number, height: number): Promise<ImageBitmap> {
  const opts = { resizeQuality: "high", imageOrientation: "from-image" } as const;
  try {
    const bmp = await createImageBitmap(file, { ...opts, resizeWidth: width, resizeHeight: height });
    if (bmp.width === width && bmp.height === height) return bmp;
    bmp.close();
    // Browsers that resize before applying orientation need the raw (unrotated) target.
    const retry = await createImageBitmap(file, { ...opts, resizeWidth: height, resizeHeight: width });
    if (retry.width === width && retry.height === height) return retry;
    retry.close();
  } catch {
    // fall through
  }
  throw new UnreadablePhotoError("Can't read this photo");
}

async function encodeVariant(source: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new UnreadablePhotoError("Canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);
  let last: ArrayBuffer | null = null;
  for (const quality of QUALITIES) {
    last = await encodeWebp(pixels, { quality });
    if (last.byteLength <= maxBytesFor(width)) break;
  }
  return new Blob([last!], { type: "image/webp" });
}

/** Fingerprint, capture time and WebP variants for one photo. Call for one photo at a time. */
export async function processPhoto(file: File): Promise<Processed> {
  const buf = await file.arrayBuffer();
  const fingerprint = hex(await crypto.subtle.digest("SHA-256", buf));
  const meta = readJpegMeta(buf);
  const takenAt = (meta?.dateTimeOriginal && exifToIso(meta.dateTimeOriginal, meta.offsetTimeOriginal)) || toOffsetIso(new Date(file.lastModified));

  let upright: { width: number; height: number };
  if (meta) {
    upright = orientedSize(meta.width, meta.height, meta.orientation);
  } else {
    const probe = await createImageBitmap(file).catch(() => null);
    if (!probe) throw new UnreadablePhotoError("Can't read this photo");
    upright = { width: probe.width, height: probe.height };
    probe.close();
  }

  const widths = selectWidths(upright.width);
  const width = widths[widths.length - 1]!;
  const height = scaledHeight(width, upright.width, upright.height);
  const largest = await decodeUpright(file, width, height);
  try {
    const variants: Processed["variants"] = [];
    for (const w of widths) variants.push({ width: w, blob: await encodeVariant(largest, w, scaledHeight(w, width, height)) });
    return { fingerprint, takenAt, width, height, variants };
  } finally {
    largest.close();
  }
}

/** Small JPEG object URL for the review grid, decoded at thumbnail size to spare iOS memory. */
export async function makeThumb(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file, { resizeWidth: 240, resizeQuality: "medium", imageOrientation: "from-image" });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0);
    bmp.close();
    return URL.createObjectURL(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 }));
  } catch {
    return null;
  }
}
