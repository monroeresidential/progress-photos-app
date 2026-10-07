import { photoAlt } from "../shared/alt";
import { largestSrc, srcsetAttr } from "../shared/srcset";
import type { AdminPhoto } from "../shared/types";
import { api, deleteNote, errorMessage } from "./api";
import { dayKey, shortDayLabel, timeLabel } from "./days";
import { h } from "./dom";
import { icon } from "./icons";

export interface ViewerOptions {
  projectName: string;
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
    img.alt = photoAlt(o.projectName, p);
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

  let busy = false;
  let stepping = false;

  async function act(btn: HTMLElement, fn: () => Promise<void>): Promise<void> {
    if (busy || stepping) return;
    busy = true;
    for (const b of [hideBtn, deleteBtn, saveBtn]) b.disabled = true;
    note.textContent = "";
    try {
      await fn();
    } catch (err) {
      if (el.isConnected) note.textContent = errorMessage(err);
    } finally {
      busy = false;
      hideBtn.disabled = false;
      deleteBtn.disabled = false;
      if (saveBtn.textContent !== "Saved") saveBtn.disabled = !captionChanged();
      if (el.isConnected && btn.isConnected && !(btn as HTMLButtonElement).disabled) btn.focus();
    }
  }

  caption.addEventListener("input", () => {
    saveBtn.textContent = "Save caption";
    saveBtn.disabled = !captionChanged();
  });
  /** Resolves true when the save went through. */
  async function save(): Promise<boolean> {
    let ok = false;
    await act(saveBtn, async () => {
      const id = current()!.id;
      const updated = await api.patch(id, { caption: caption.value.trim() || null });
      ok = true;
      o.onUpdate(updated);
      if (!el.isConnected || current()?.id !== id) return;
      caption.value = updated.caption ?? "";
      renderInfo();
      saveBtn.textContent = "Saved";
      saveBtn.disabled = true;
    });
    return ok;
  }
  saveBtn.addEventListener("click", () => void save());
  caption.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (!saveBtn.disabled) void save();
  });

  /** True when it's fine to leave this photo: nothing unsaved, or the user chose save (and it worked) or discard. */
  async function canLeave(): Promise<boolean> {
    if (!captionChanged()) return true;
    if (busy || stepping) return false;
    if (!confirm("Save caption changes?")) return true;
    return save();
  }
  hideBtn.addEventListener("click", () =>
    void act(hideBtn, async () => {
      const p = current()!;
      const id = p.id;
      o.onUpdate(await api.patch(id, { hidden: !p.hidden }));
      if (el.isConnected && current()?.id === id) renderInfo();
    }),
  );
  deleteBtn.addEventListener("click", () =>
    void act(deleteBtn, async () => {
      const p = current()!;
      if (!confirm("Delete this photo? This can't be undone.")) return;
      const res = await api.remove(p.id);
      const message = deleteNote(res);
      o.onDelete(p.id, message);
      if (o.photos().length === 0 && o.hasMore()) {
        try {
          await o.loadMore();
        } catch (err) {
          if (o.photos().length === 0) return close();
          note.textContent = errorMessage(err);
        }
        if (!el.isConnected) return;
      }
      if (o.photos().length === 0) return close();
      if (index >= o.photos().length) index = o.photos().length - 1;
      render();
      note.textContent = message;
    }),
  );
  closeBtn.addEventListener("click", () => void tryClose());

  async function tryClose(): Promise<void> {
    if (await canLeave() && el.isConnected) close();
  }

  async function step(delta: 1 | -1): Promise<void> {
    if (busy || stepping) return;
    if (index + delta < 0) return;
    const from = index;
    if (!(await canLeave()) || !el.isConnected || index !== from) return;
    if (index + delta >= o.photos().length) {
      if (!o.hasMore()) return;
      stepping = true;
      try {
        await o.loadMore();
      } catch (err) {
        if (el.isConnected) note.textContent = errorMessage(err);
        return;
      } finally {
        stepping = false;
      }
      if (!el.isConnected) return;
    }
    const n = index + delta;
    if (n < 0 || n >= o.photos().length) return;
    index = n;
    render();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      void tryClose();
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
