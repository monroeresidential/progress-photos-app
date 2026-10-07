import { randomBytes } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";

/** Minimal lossy-WebP header the Worker accepts (it validates headers, not pixels). */
export function fakeWebp(width: number, height: number): Buffer {
  const b = Buffer.alloc(64);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WEBP", 8, "ascii");
  b.write("VP8 ", 12, "ascii");
  b.writeUInt32LE(b.length - 20, 16);
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(width & 0x3fff, 26);
  b.writeUInt16LE(height & 0x3fff, 28);
  return b;
}

/** Adds a photo straight through the admin API (DEV_AUTH_EMAIL on localhost; no Origin, so the CSRF guard passes). */
export async function addPhoto(
  request: APIRequestContext,
  project: string,
  o: { takenAt: string; caption?: string; area?: string; hidden?: boolean },
): Promise<string> {
  const res = await request.post("/api/admin/photos", {
    multipart: {
      project,
      fingerprint: randomBytes(32).toString("hex"),
      takenAt: o.takenAt,
      ...(o.caption ? { caption: o.caption } : {}),
      ...(o.area ? { area: o.area } : {}),
      width: "480",
      height: "360",
      w480: { name: "w480.webp", mimeType: "image/webp", buffer: fakeWebp(480, 360) },
    },
  });
  if (res.status() !== 201) throw new Error(`addPhoto: ${res.status()} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  if (o.hidden) await request.patch(`/api/admin/photos/${id}`, { data: { hidden: true } });
  return id;
}

export async function clearProject(request: APIRequestContext, project: string): Promise<void> {
  for (;;) {
    const page = (await (await request.get(`/api/admin/photos?project=${project}`)).json()) as { photos: { id: string }[] };
    if (page.photos.length === 0) return;
    for (const p of page.photos) await request.delete(`/api/admin/photos/${p.id}`);
  }
}

export async function adminPhotos(request: APIRequestContext, project: string) {
  return ((await (await request.get(`/api/admin/photos?project=${project}`)).json()) as {
    photos: { id: string; caption: string | null; area: string | null; hidden: boolean }[];
  }).photos;
}

/** A real JPEG drawn in the page, so the upload pipeline (decode, resize, WASM WebP) runs for real. */
export async function jpegFromPage(page: Page, text: string): Promise<Buffer> {
  const b64 = await page.evaluate(async (t) => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#a33";
    ctx.fillRect(0, 0, 1200, 900);
    ctx.fillStyle = "#fff";
    ctx.font = "48px sans-serif";
    ctx.fillText(t, 40, 100);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.9));
    let s = "";
    for (const x of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(x);
    return btoa(s);
  }, text);
  return Buffer.from(b64, "base64");
}
