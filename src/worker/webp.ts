/** Dimensions from a WebP header, or null if the bytes aren't WebP. Header-only; does not decode. */
export function readWebpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return null;

  switch (ascii(12, 4)) {
    case "VP8 ": // lossy: frame tag (3), start code 9d 01 2a, then 14-bit width/height
      if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
      return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    case "VP8L": {
      if (b[20] !== 0x2f) return null;
      const bits = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0;
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    case "VP8X": // extended: 24-bit canvas width-1 / height-1
      return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
    default:
      return null;
  }
}
