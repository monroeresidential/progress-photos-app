export const imageKey = (slug: string, id: string, width: number) => `${slug}/${id}-${width}w.webp`;

export const imageUrl = (base: string, slug: string, id: string, width: number) => `${base}/img/${imageKey(slug, id, width)}`;

/** Also the edge-cache key and the purge URL for a feed page, so these must stay identical. */
export const feedUrl = (base: string, slug: string, cursor?: string) =>
  `${base}/api/feed/${slug}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
