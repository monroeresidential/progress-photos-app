const SVG_NS = "http://www.w3.org/2000/svg";

/** Lucide icon paths (circles and rects written as paths), 24×24, drawn with stroke. */
const ICONS = {
  camera: ["M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z", "M9 13a3 3 0 1 0 6 0a3 3 0 1 0-6 0"],
  image: ["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z", "M7 9a2 2 0 1 0 4 0a2 2 0 1 0-4 0", "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "external-link": ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  "eye-off": [
    "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
    "M14.084 14.158a3 3 0 0 1-4.242-4.242",
    "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
    "m2 2 20 20",
  ],
  eye: ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0"],
  "more-horizontal": ["M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0", "M18 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0", "M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0"],
  "trash-2": ["M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2", "M10 11v6", "M14 11v6"],
  pencil: [
    "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
    "m15 5 4 4",
  ],
  check: ["M20 6 9 17l-5-5"],
  plus: ["M5 12h14", "M12 5v14"],
} as const;

export type IconName = keyof typeof ICONS;

/** The PP monogram (one "P" path, mirrored), 200×200, filled with currentColor. */
const MARK_P = "M36.70 154L20.50 154L20.50 49L62.20 49Q71.80 49 79.38 52.83Q86.95 56.65 91.22 63.63Q95.50 70.60 95.50 80.35L95.50 80.35L95.50 82.30Q95.50 92.05 91.07 99.10Q86.65 106.15 79.15 109.90Q71.65 113.65 62.20 113.65L62.20 113.65L36.70 113.65L36.70 154ZM36.70 63.70L36.70 98.95L60.55 98.95Q69.10 98.95 74.20 94.45Q79.30 89.95 79.30 82.15L79.30 82.15L79.30 80.65Q79.30 72.70 74.20 68.20Q69.10 63.70 60.55 63.70L60.55 63.70L36.70 63.70Z";

export function mark(size = 26): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 200 200");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "mark");
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("transform", "translate(0 -1.5)");
  for (const mirror of [false, true]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", MARK_P);
    if (mirror) path.setAttribute("transform", "translate(200 0) scale(-1 1)");
    g.append(path);
  }
  svg.append(g);
  return svg;
}

export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const attrs: Record<string, string> = {
    viewBox: "0 0 24 24",
    width: String(size),
    height: String(size),
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    class: "icon",
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const d of ICONS[name]) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}
