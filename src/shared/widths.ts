export const STANDARD_WIDTHS = [480, 960, 1920] as const;

const KiB = 1024;
const MAX_BYTES: Record<number, number> = { 480: 150 * KiB, 960: 500 * KiB, 1920: 1536 * KiB };

/** Widths to store for an image whose upright width is `originalWidth`. Never upscales. */
export function selectWidths(originalWidth: number): number[] {
  const fit = STANDARD_WIDTHS.filter((w) => w <= originalWidth);
  return fit.length > 0 ? [...fit] : [originalWidth];
}

/** Byte cap for a stored variant. A sub-480 original uses the 480w cap. */
export function maxBytesFor(width: number): number {
  return MAX_BYTES[width] ?? 150 * KiB;
}

export function scaledHeight(width: number, largestWidth: number, largestHeight: number): number {
  return Math.max(1, Math.round((largestHeight * width) / largestWidth));
}
