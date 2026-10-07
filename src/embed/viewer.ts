import { photoAlt } from "../shared/alt";
import { largestSrc, srcsetAttr } from "../shared/srcset";
import type { FeedPhoto } from "../shared/types";

export interface ViewerSource {
  count(): number;
  photo(i: number): FeedPhoto | undefined;
  hasMore(): boolean;
  loadMore(): Promise<void>;
  opener(i: number): HTMLElement | undefined;
  projectName(): string;
}

const SWIPE_PX = 50;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Stroke icon drawn in currentColor, so it follows the button's (themable) color. */
function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

function button(cls: string, label: string, path: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.setAttribute("aria-label", label);
  b.append(icon(path));
  return b;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export class Viewer {
  readonly element = document.createElement("div");
  #stage = node("div", "viewer-stage loading");
  #img = node("img", "viewer-img");
  #caption = node("figcaption", "viewer-caption");
  #counter = node("span", "viewer-counter");
  #captionText = node("span", "viewer-caption-text");
  #close = button("close", "Close", "M6 6l12 12M18 6L6 18");
  #prev = button("prev", "Previous photo", "M15 5l-7 7 7 7");
  #next = button("next", "Next photo", "M9 5l7 7-7 7");
  /** Neighbours being fetched ahead of time; held so they aren't garbage-collected mid-load. */
  #preloads: HTMLImageElement[] = [];
  /** Increments per render so a slow earlier image can't reveal itself over a newer one. */
  #renderId = 0;
  #index = -1;
  #startX: number | null = null;
  #swiped = false;
  #savedOverflow = "";
  readonly root: ShadowRoot;
  readonly src: ViewerSource;

  constructor(root: ShadowRoot, src: ViewerSource) {
    this.root = root;
    this.src = src;
    const el = this.element;
    el.className = "overlay";
    el.hidden = true;
    el.tabIndex = -1;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Photo viewer");
    this.#img.decoding = "async";
    this.#stage.append(this.#img, node("span", "viewer-spinner"));
    this.#counter.setAttribute("aria-live", "polite");
    this.#caption.append(this.#counter, this.#captionText);
    const figure = document.createElement("figure");
    figure.append(this.#stage, this.#caption);
    el.append(figure, this.#prev, this.#next, this.#close);

    this.#close.addEventListener("click", () => this.close());
    this.#prev.addEventListener("click", () => void this.step(-1));
    this.#next.addEventListener("click", () => void this.step(1));
    el.addEventListener("click", (e) => {
      if (this.#swiped) {
        this.#swiped = false;
        return;
      }
      if (e.target === el) this.close();
    });
    el.addEventListener("keydown", (e) => this.#onKey(e));
    el.addEventListener("pointerdown", (e) => {
      this.#startX = e.clientX;
      this.#swiped = false;
      if (!(e.target instanceof HTMLButtonElement)) el.focus({ preventScroll: true });
    });
    el.addEventListener("pointerup", (e) => {
      if (this.#startX === null) return;
      const dx = e.clientX - this.#startX;
      this.#startX = null;
      if (Math.abs(dx) > SWIPE_PX) {
        this.#swiped = true;
        void this.step(dx < 0 ? 1 : -1);
      }
    });
    el.addEventListener("pointercancel", () => (this.#startX = null));
  }

  get isOpen(): boolean {
    return this.#index >= 0;
  }

  open(i: number): void {
    this.#index = i;
    this.element.hidden = false;
    this.#savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    this.#render();
    this.#close.focus();
  }

  /** Close without returning focus, for when the host element is leaving the DOM. */
  dismiss(): void {
    this.close(false);
  }

  close(restoreFocus = true): void {
    if (!this.isOpen) return;
    const i = this.#index;
    this.#index = -1;
    this.#renderId++; // any load still in flight must not reveal anything
    this.#stage.classList.add("loading");
    this.#img.removeAttribute("srcset");
    this.#img.removeAttribute("src");
    this.#preloads = [];
    this.element.hidden = true;
    document.documentElement.style.overflow = this.#savedOverflow;
    if (restoreFocus) this.src.opener(i)?.focus();
  }

  async step(delta: 1 | -1): Promise<void> {
    const n = this.#index + delta;
    if (!this.isOpen || n < 0) return;
    if (n >= this.src.count()) {
      if (!this.src.hasMore()) return;
      await this.src.loadMore();
      if (!this.isOpen || n >= this.src.count()) return;
    }
    this.#index = n;
    this.#render();
  }

  #render(): void {
    const p = this.src.photo(this.#index);
    if (!p) return;
    const id = ++this.#renderId;
    const img = this.#img;
    // Hide first, synchronously: the previous photo must never show while the new one loads.
    this.#stage.classList.add("loading");
    img.removeAttribute("srcset");
    img.width = p.width;
    img.height = p.height;
    img.alt = photoAlt(this.src.projectName(), p);
    img.sizes = "100vw";
    img.srcset = srcsetAttr(p.srcset);
    img.src = largestSrc(p.srcset);
    const reveal = () => {
      if (id === this.#renderId) this.#stage.classList.remove("loading");
    };
    // decode() resolves once the new image is ready to paint; on failure, reveal anyway so
    // the browser's broken-image state (and alt text) shows instead of an endless spinner.
    img.decode().then(reveal, reveal);
    this.#preloadNeighbours();

    this.#captionText.textContent = p.caption ?? "";
    this.#counter.textContent = `${this.#index + 1} / ${this.src.count()}${this.src.hasMore() ? "+" : ""}`;
    const prevOff = this.#index === 0;
    const nextOff = this.#index >= this.src.count() - 1 && !this.src.hasMore();
    const active = this.root.activeElement;
    if ((prevOff && active === this.#prev) || (nextOff && active === this.#next)) this.#close.focus();
    this.#prev.disabled = prevOff;
    this.#next.disabled = nextOff;
  }

  /** Start fetching the photos either side so stepping is instant. */
  #preloadNeighbours(): void {
    this.#preloads = [this.#index - 1, this.#index + 1].flatMap((i) => {
      const p = i >= 0 ? this.src.photo(i) : undefined;
      if (!p) return [];
      const pre = new Image();
      pre.decoding = "async";
      pre.sizes = "100vw";
      pre.srcset = srcsetAttr(p.srcset);
      pre.src = largestSrc(p.srcset);
      return [pre];
    });
  }

  #onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      this.close();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      void this.step(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      void this.step(-1);
    } else if (e.key === "Tab") {
      const focusable = [this.#prev, this.#next, this.#close].filter((b) => !b.disabled);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = this.root.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first?.focus();
      } else if (!focusable.includes(active as HTMLButtonElement)) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
}
