type Srcset = Record<string, string>;

const sorted = (s: Srcset) =>
  Object.entries(s)
    .map(([w, url]) => [Number(w), url] as const)
    .sort((a, b) => a[0] - b[0]);

export function srcsetAttr(s: Srcset): string {
  return sorted(s).map(([w, url]) => `${url} ${w}w`).join(", ");
}

export function smallestSrc(s: Srcset): string {
  return sorted(s)[0]?.[1] ?? "";
}

export function largestSrc(s: Srcset): string {
  const all = sorted(s);
  return all[all.length - 1]?.[1] ?? "";
}
