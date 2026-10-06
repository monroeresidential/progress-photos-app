/** Builds a minimal JPEG: SOI, optional APP1/Exif (IFD0 orientation + Exif IFD dates), SOF0, SOS. */
export function fakeJpeg(o: {
  width: number;
  height: number;
  orientation?: number;
  dateTimeOriginal?: string;
  offsetTimeOriginal?: string;
  bigEndian?: boolean;
}): ArrayBuffer {
  const le = !o.bigEndian;
  const t: number[] = [];
  const u16 = (v: number) => (le ? t.push(v & 0xff, v >> 8) : t.push(v >> 8, v & 0xff));
  const u32 = (v: number) =>
    le ? t.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff) : t.push((v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);

  const hasExifIfd = o.dateTimeOriginal !== undefined || o.offsetTimeOriginal !== undefined;
  const n0 = (o.orientation !== undefined ? 1 : 0) + (hasExifIfd ? 1 : 0);
  const n1 = (o.dateTimeOriginal !== undefined ? 1 : 0) + (o.offsetTimeOriginal !== undefined ? 1 : 0);
  const exifIfdAt = 8 + 2 + 12 * n0 + 4;
  const dataAt = exifIfdAt + 2 + 12 * n1 + 4;
  const dto = o.dateTimeOriginal !== undefined ? `${o.dateTimeOriginal}\0` : "";
  const ofs = o.offsetTimeOriginal !== undefined ? `${o.offsetTimeOriginal}\0` : "";

  t.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]));
  u16(42);
  u32(8);
  u16(n0);
  if (o.orientation !== undefined) {
    u16(0x0112); u16(3); u32(1); u16(o.orientation); u16(0);
  }
  if (hasExifIfd) {
    u16(0x8769); u16(4); u32(1); u32(exifIfdAt);
  }
  u32(0);
  if (hasExifIfd) {
    u16(n1);
    if (dto) { u16(0x9003); u16(2); u32(dto.length); u32(dataAt); }
    if (ofs) { u16(0x9011); u16(2); u32(ofs.length); u32(dataAt + dto.length); }
    u32(0);
    for (const ch of dto + ofs) t.push(ch.charCodeAt(0));
  }

  const bytes: number[] = [0xff, 0xd8];
  if (n0 > 0) {
    const len = 2 + 6 + t.length;
    bytes.push(0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...t);
  }
  bytes.push(0xff, 0xc0, 0x00, 0x11, 8, o.height >> 8, o.height & 0xff, o.width >> 8, o.width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1);
  bytes.push(0xff, 0xda, 0x00, 0x02, 0xff, 0xd9);
  return new Uint8Array(bytes).buffer;
}
