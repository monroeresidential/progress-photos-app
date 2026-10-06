import { largestSrc, srcsetAttr } from "../shared/srcset";
import type { FeedPhoto } from "../shared/types";

export interface ViewerSource {
  count(): number;
  photo(i: number): FeedPhoto | undefined;
  hasMore(): boolean;
  loadMore(): Promise<void>;
  opener(i: number): HTMLElement | undefined;
}

const SWIPE_PX = 50;

function button(cls: string, label: string, text: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.setAttribute("aria-label", label);
  b.textContent = text;
  return b;
}

export class Viewer {
  readonly element = document.createElement("div");
  #img = document.createElement("img");
  #caption = document.createElement("figcaption");
  #close = button("close", "Close", "✕");
  #prev = button("prev", "Previous photo", "‹");
  #next = button("next", "Next photo", "›");
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
    this.#img.className = "viewer-img";
    this.#caption.className = "viewer-caption";
    const figure = document.createElement("figure");
    figure.append(this.#img, this.#caption);
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
    const img = this.#img;
    img.removeAttribute("srcset");
    img.width = p.width;
    img.height = p.height;
    img.alt = p.caption ?? "Construction progress photo";
    img.sizes = "100vw";
    img.srcset = srcsetAttr(p.srcset);
    img.src = largestSrc(p.srcset);
    this.#caption.textContent = p.caption ?? "";
    const prevOff = this.#index === 0;
    const nextOff = this.#index >= this.src.count() - 1 && !this.src.hasMore();
    const active = this.root.activeElement;
    if ((prevOff && active === this.#prev) || (nextOff && active === this.#next)) this.#close.focus();
    this.#prev.disabled = prevOff;
    this.#next.disabled = nextOff;
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
