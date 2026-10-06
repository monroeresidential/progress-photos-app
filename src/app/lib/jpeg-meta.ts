export interface JpegMeta {
  width: number;
  height: number;
  orientation: number;
  dateTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const ascii = (v: DataView, at: number, n: number) => {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(v.getUint8(at + i));
  return s;
};

/** Size, EXIF orientation and capture time from a JPEG's headers. Null if it isn't a readable JPEG. */
export function readJpegMeta(buf: ArrayBuffer): JpegMeta | null {
  const v = new DataView(buf);
  try {
    if (v.getUint16(0) !== 0xffd8) return null;
    const meta: JpegMeta = { width: 0, height: 0, orientation: 1, dateTimeOriginal: null, offsetTimeOriginal: null };
    let o = 2;
    while (o + 4 <= v.byteLength) {
      if (v.getUint8(o) !== 0xff) return null;
      const marker = v.getUint8(o + 1);
      if (marker === 0xff) {
        o++;
        continue;
      }
      const len = v.getUint16(o + 2);
      if (marker === 0xe1 && len >= 8 && ascii(v, o + 4, 6) === "Exif\0\0") readExif(v, o + 10, meta);
      if (SOF.has(marker)) {
        meta.height = v.getUint16(o + 5);
        meta.width = v.getUint16(o + 7);
        return meta.width > 0 && meta.height > 0 ? meta : null;
      }
      if (marker === 0xda) return null;
      o += 2 + len;
    }
    return null;
  } catch {
    return null;
  }
}

function readExif(v: DataView, t: number, meta: JpegMeta): void {
  try {
    const le = ascii(v, t, 2) === "II";
    const u16 = (p: number) => v.getUint16(t + p, le);
    const u32 = (p: number) => v.getUint32(t + p, le);
    const entries = (ifd: number) => {
      const map = new Map<number, number>();
      const n = u16(ifd);
      for (let i = 0; i < n; i++) map.set(u16(ifd + 2 + i * 12), ifd + 2 + i * 12);
      return map;
    };
    const str = (entry: number) => {
      const count = u32(entry + 4);
      const at = count > 4 ? u32(entry + 8) : entry + 8;
      return ascii(v, t + at, count).replace(/\0+$/, "");
    };

    const ifd0 = entries(u32(4));
    const ori = ifd0.get(0x0112);
    if (ori !== undefined) meta.orientation = u16(ori + 8);
    const exifPtr = ifd0.get(0x8769);
    if (exifPtr !== undefined) {
      const exif = entries(u32(exifPtr + 8));
      const dto = exif.get(0x9003);
      if (dto !== undefined) meta.dateTimeOriginal = str(dto);
      const ofs = exif.get(0x9011);
      if (ofs !== undefined) meta.offsetTimeOriginal = str(ofs);
    }
  } catch {
    // Corrupt EXIF: keep whatever was read; size still comes from SOF.
  }
}

/** EXIF orientations 5–8 rotate by 90°, so the upright image has width and height swapped. */
export function orientedSize(width: number, height: number, orientation: number) {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}
