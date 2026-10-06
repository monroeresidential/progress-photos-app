import type { Env } from "./env";

/** Purges URLs from Cloudflare's cache (incl. Cache API entries). Never throws; false = not purged. */
export async function purgeUrls(fetchFn: typeof fetch, env: Env, urls: string[]): Promise<boolean> {
  if (!env.CF_PURGE_TOKEN) {
    console.warn("CF_PURGE_TOKEN not set; skipping cache purge");
    return false;
  }
  try {
    const res = await fetchFn(`https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/purge_cache`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_PURGE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ files: urls }),
    });
    const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
    if (res.ok && body?.success) return true;
    console.error("Cache purge failed", res.status, JSON.stringify(body));
    return false;
  } catch (err) {
    console.error("Cache purge failed", err);
    return false;
  }
}
