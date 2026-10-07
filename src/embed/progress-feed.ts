import { smallestSrc, srcsetAttr } from "../shared/srcset";
import type { FeedPage, FeedPhoto } from "../shared/types";
import { photoAlt } from "../shared/alt";
import { dayKey, formatDay } from "./days";
import { STYLES } from "./styles";
import { Viewer } from "./viewer";

const API_BASE = new URL(import.meta.url).origin;
const SIZES = "(min-width: 1200px) 400px, (min-width: 640px) 50vw, 100vw";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

export class ProgressFeed extends HTMLElement {
  #shadow = this.attachShadow({ mode: "open" });
  #projectName = "";
  #days = el("div", "days");
  #status = el("div", "status");
  #sentinel = el("div", "sentinel");
  #photos: FeedPhoto[] = [];
  #buttons: HTMLButtonElement[] = [];
  #lastDay: { key: string; grid: HTMLElement } | null = null;
  #cursor: string | null = null;
  #started = false;
  #loading: Promise<void> | null = null;
  #done = false;
  #failed = false;
  #sentinelVisible = false;
  #observer = new IntersectionObserver(
    (entries) => {
      this.#sentinelVisible = entries.some((e) => e.isIntersecting);
      if (this.#sentinelVisible && !this.#failed) void this.loadMore();
    },
    { rootMargin: "800px 0px" },
  );
  #viewer = new Viewer(this.#shadow, {
    count: () => this.#photos.length,
    photo: (i) => this.#photos[i],
    hasMore: () => !this.#done,
    loadMore: () => this.loadMore(),
    opener: (i) => this.#buttons[i],
    projectName: () => this.#projectName,
  });

  connectedCallback(): void {
    if (!this.#started) {
      this.#started = true;
      this.#status.setAttribute("role", "status");
      const style = document.createElement("style");
      style.textContent = STYLES;
      this.#shadow.append(style, this.#days, this.#status, this.#sentinel, this.#viewer.element);
      void this.loadMore();
    }
    this.#observer.observe(this.#sentinel);
  }

  disconnectedCallback(): void {
    this.#observer.disconnect();
    this.#viewer.dismiss(); // restores the host page's overflow
  }

  loadMore(): Promise<void> {
    if (this.#loading) return this.#loading;
    if (this.#done) return Promise.resolve();
    const p: Promise<void> = this.#load().finally(() => {
      if (this.#loading === p) this.#loading = null;
      if (!this.#done && !this.#failed && this.#sentinelVisible) void this.loadMore();
    });
    this.#loading = p;
    return p;
  }

  async #load(): Promise<void> {
    const project = this.getAttribute("project");
    if (!project) {
      this.#failed = true;
      this.#showError();
      return;
    }
    this.#failed = false;
    this.#setStatus("Loading photos…");
    try {
      const url = new URL(`/api/feed/${encodeURIComponent(project)}`, API_BASE);
      if (this.#cursor) url.searchParams.set("cursor", this.#cursor);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page = (await res.json()) as FeedPage;
      this.#projectName = page.project.name;
      for (const p of page.photos) this.#append(p);
      this.#cursor = page.nextCursor;
      this.#done = page.nextCursor === null;
      if (this.#done) this.#setStatus(this.#photos.length === 0 ? "No photos yet." : "That's the beginning", this.#photos.length > 0);
      else this.#setStatus("");
    } catch {
      this.#failed = true;
      this.#showError();
      return;
    }
  }

  #setStatus(text: string, isEnd = false): void {
    this.#status.className = isEnd ? "status end" : "status";
    this.#status.textContent = text;
  }

  #showError(): void {
    const retry = el("button", "retry");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => void this.loadMore());
    this.#status.className = "status error";
    this.#status.replaceChildren("Couldn't load photos", retry);
  }

  #append(p: FeedPhoto): void {
    const key = dayKey(p.takenAt);
    if (this.#lastDay?.key !== key) {
      const section = el("section", "day");
      const heading = el("h2", "day-heading");
      heading.textContent = formatDay(key);
      const grid = el("div", "grid");
      section.append(heading, grid);
      this.#days.append(section);
      this.#lastDay = { key, grid };
    }
    const index = this.#photos.length;
    this.#photos.push(p);

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.width = p.width;
    img.height = p.height;
    img.alt = photoAlt(this.#projectName, p);
    img.sizes = SIZES;
    img.srcset = srcsetAttr(p.srcset);
    img.src = smallestSrc(p.srcset);

    const open = el("button", "open");
    open.type = "button";
    open.append(img);
    open.addEventListener("click", () => this.#viewer.open(index));
    this.#buttons.push(open);

    const figure = el("figure", "photo");
    figure.append(open);
    if (p.caption) {
      const cap = el("figcaption", "caption");
      cap.textContent = p.caption;
      figure.append(cap);
    }
    this.#lastDay.grid.append(figure);
  }
}

if (!customElements.get("progress-feed")) customElements.define("progress-feed", ProgressFeed);
