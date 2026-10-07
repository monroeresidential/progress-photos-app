import { largestSrc, srcsetAttr } from "../shared/srcset";
import type { AdminPhoto } from "../shared/types";
import { api, deleteNote, errorMessage } from "./api";
import { dayKey, shortDayLabel, timeLabel } from "./days";
import { h } from "./dom";
import { icon } from "./icons";

export interface ViewerOptions {
  photos(): AdminPhoto[];
  index: number;
  hasMore(): boolean;
  loadMore(): Promise<void>;
  onUpdate(p: AdminPhoto): void;
  onDelete(id: string, note: string): void;
  returnFocus(id: string): HTMLElement | null;
}

const SWIPE_PX = 50;

export function openViewer(o: ViewerOptions): void {
  let index = o.index;
  let renderId = 0;
  let startX: number | null = null;
  let preloads: HTMLImageElement[] = [];
  let lastId = o.photos()[index]?.id ?? "";

  const pos = h("div", { class: "viewer-pos tabular", "aria-live": "polite" });
  const img = h("img", { alt: "" });
  const stage = h("div", { class: "viewer-stage loading" }, img);
  const when = h("span", { class: "when tabular" });
  const tag = h("span", { class: "status-tag" });
  const caption = h("input", { class: "viewer-caption", type: "text", maxLength: 280, placeholder: "Add a caption", "aria-label": "Caption" });
  const hideBtn = h("button", { type: "button", class: "btn" });
  const deleteBtn = h("button", { type: "button", class: "btn" }, icon("trash-2", 18), "Delete");
  const saveBtn = h("button", { type: "button", class: "btn btn-save", disabled: true }, "Save caption");
  const note = h("p", { class: "viewer-note", role: "status" });
  const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Close" }, icon("x", 22));
  const el = h(
    "div",
    { class: "viewer", role: "dialog", "aria-modal": "true", "aria-label": "Photo", tabIndex: -1 },
    h("div", { class: "viewer-top" }, closeBtn, pos, h("span")),
    stage,
    h("div", { class: "viewer-sheet" }, h("div", { class: "viewer-meta" }, when, tag), caption, h("div", { class: "viewer-actions" }, hideBtn, deleteBtn, saveBtn), note),
  );

  const savedOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = "hidden";
  document.body.append(el);

  const current = () => o.photos()[index];
  const captionChanged = () => caption.value.trim() !== (current()?.caption ?? "");

  /** Text and buttons only; doesn't touch the image. */
  function renderInfo(): void {
    const p = current();
    if (!p) return;
    lastId = p.id;
    pos.textContent = `${index + 1} of ${o.photos().length}${o.hasMore() ? "+" : ""} · ${shortDayLabel(dayKey(p.takenAt))}`;
    when.textContent = [timeLabel(p.takenAt, true), p.area].filter(Boolean).join(" · ");
    tag.className = `status-tag${p.hidden ? " is-hidden" : ""}`;
    tag.replaceChildren(icon(p.hidden ? "eye-off" : "check", 12), p.hidden ? "Hidden" : "Live on site");
    hideBtn.replaceChildren(icon(p.hidden ? "eye" : "eye-off", 18), p.hidden ? "Unhide" : "Hide");
  }

  function render(): void {
    const p = current();
    if (!p) return close();
    const id = ++renderId;
    // Hide first: the previous photo must never show while this one loads.
    stage.classList.add("loading");
    img.removeAttribute("srcset");
    img.alt = p.caption ?? "Progress photo";
    img.sizes = "100vw";
    img.srcset = srcsetAttr(p.srcset);
    img.src = largestSrc(p.srcset);
    const reveal = () => {
      if (id === renderId) stage.classList.remove("loading");
    };
    img.decode().then(reveal, reveal);
    preloads = [index - 1, index + 1].flatMap((i) => {
      const q = o.photos()[i];
      if (!q) return [];
      const pre = new Image();
      pre.sizes = "100vw";
      pre.srcset = srcsetAttr(q.srcset);
      pre.src = largestSrc(q.srcset);
      return [pre];
    });
    caption.value = p.caption ?? "";
    saveBtn.disabled = true;
    saveBtn.textContent = "Save caption";
    note.textContent = "";
    renderInfo();
  }

  async function act(fn: () => Promise<void>): Promise<void> {
    for (const b of [hideBtn, deleteBtn, saveBtn]) b.disabled = true;
    note.textContent = "";
    try {
      await fn();
    } catch (err) {
      note.textContent = errorMessage(err);
    } finally {
      hideBtn.disabled = false;
      deleteBtn.disabled = false;
      if (saveBtn.textContent !== "Saved") saveBtn.disabled = !captionChanged();
    }
  }

  caption.addEventListener("input", () => {
    saveBtn.textContent = "Save caption";
    saveBtn.disabled = !captionChanged();
  });
  saveBtn.addEventListener("click", () =>
    void act(async () => {
      const updated = await api.patch(current()!.id, { caption: caption.value.trim() || null });
      o.onUpdate(updated);
      caption.value = updated.caption ?? "";
      renderInfo();
      saveBtn.textContent = "Saved";
      saveBtn.disabled = true;
    }),
  );
  hideBtn.addEventListener("click", () =>
    void act(async () => {
      const p = current()!;
      o.onUpdate(await api.patch(p.id, { hidden: !p.hidden }));
      renderInfo();
    }),
  );
  deleteBtn.addEventListener("click", () =>
    void act(async () => {
      const p = current()!;
      if (!confirm("Delete this photo? This can't be undone.")) return;
      const res = await api.remove(p.id);
      const message = deleteNote(res);
      o.onDelete(p.id, message);
      if (o.photos().length === 0) return close();
      if (index >= o.photos().length) index = o.photos().length - 1;
      render();
      note.textContent = message;
    }),
  );
  closeBtn.addEventListener("click", () => close());

  async function step(delta: 1 | -1): Promise<void> {
    const n = index + delta;
    if (n < 0) return;
    if (n >= o.photos().length) {
      if (!o.hasMore()) return;
      await o.loadMore();
      if (!el.isConnected || n >= o.photos().length) return;
    }
    index = n;
    render();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && e.target !== caption) {
      e.preventDefault();
      void step(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Tab") {
      const focusable = [...el.querySelectorAll<HTMLElement>("button:not(:disabled), input")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      } else if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  document.addEventListener("keydown", onKey);

  stage.addEventListener("pointerdown", (e) => (startX = e.clientX));
  stage.addEventListener("pointercancel", () => (startX = null));
  stage.addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > SWIPE_PX) void step(dx < 0 ? 1 : -1);
  });

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    renderId++;
    preloads = [];
    document.removeEventListener("keydown", onKey);
    el.remove();
    document.documentElement.style.overflow = savedOverflow;
    o.returnFocus(lastId)?.focus();
  }

  render();
  closeBtn.focus();
}
