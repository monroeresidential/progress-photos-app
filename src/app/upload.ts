import { toOffsetIso } from "../shared/time";
import type { ProjectSummary } from "../shared/types";
import { api, ApiError, errorMessage, uploadPhoto } from "./api";
import { timeRange } from "./days";
import { h } from "./dom";
import { icon } from "./icons";
import { readCaptureTime } from "./lib/jpeg-meta";
import { makeThumb, processPhoto, UnreadablePhotoError, type Processed } from "./lib/process";

type Status = "ready" | "working" | "done" | "duplicate" | "unreadable" | "failed" | "signin";

const LABEL: Record<Status, string> = {
  ready: "Ready",
  working: "Uploading…",
  done: "Done",
  duplicate: "Duplicate (already uploaded)",
  unreadable: "Can't read this photo",
  failed: "Failed",
  signin: "Sign-in expired — sign in again, then Retry",
};
/** How long a finished row shows its status before fading out. */
const LEAVE_AFTER_MS = 700;
const FADE_MS = 300;
/** EXIF sits in the first few KB; never read a whole 48 MP file just for the time. */
const HEADER_BYTES = 256 * 1024;

interface Item {
  file: File;
  takenAt: string;
  status: Status;
  processed?: Processed;
  row: HTMLLIElement;
  thumb: HTMLImageElement;
  caption: HTMLInputElement;
  statusText: HTMLSpanElement;
  progress: HTMLDivElement;
  fill: HTMLDivElement;
  retry: HTMLButtonElement;
  remove: HTMLButtonElement;
}

export interface UploadTab {
  projectChanged(): void;
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

async function captureTime(file: File): Promise<string> {
  try {
    const t = readCaptureTime(await file.slice(0, HEADER_BYTES).arrayBuffer());
    if (t) return t;
  } catch {
    // fall through to lastModified
  }
  return toOffsetIso(new Date(file.lastModified));
}

export function mountUpload(container: HTMLElement, getProject: () => ProjectSummary, onRunningChange?: (running: boolean) => void): UploadTab {
  const items: Item[] = [];
  let running = false;
  let area: string | null = null;
  let areas: string[] = [];
  let finished = { done: 0, duplicate: 0 };
  let areaRequest = 0;
  let adding = false;
  let pendingRender = false;

  const cameraInput = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onchange: () => void addFiles(cameraInput) });
  const libraryInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: () => void addFiles(libraryInput) });
  const batchCaption = h("input", { class: "input", type: "text", id: "batch-caption", maxLength: 280, placeholder: "Optional" });
  const pills = h("div", { class: "pills", role: "group", "aria-label": "Area" });
  const summary = h("span", { class: "queue-summary tabular", role: "status" });
  const range = h("span", { class: "queue-range tabular" });
  const queue = h("ul", { class: "queue" });
  const notice = h(
    "p",
    { class: "notice", hidden: true },
    "Your sign-in expired. ",
    h("a", { href: "/", target: "_blank", rel: "noopener" }, "Sign in again"),
    " If Retry still fails, close and reopen the app.",
  );
  const uploadBtn = h("button", { type: "button", class: "btn btn-primary", disabled: true, onclick: () => void runQueue() }, "Upload");

  container.replaceChildren(
    h(
      "div",
      { class: "tab-body" },
      h(
        "div",
        { class: "action-row" },
        h("button", { type: "button", class: "btn btn-primary", onclick: () => cameraInput.click() }, icon("camera"), "Take photo"),
        h("button", { type: "button", class: "btn btn-secondary", onclick: () => libraryInput.click() }, icon("image"), "Library"),
        cameraInput,
        libraryInput,
      ),
      h("div", { class: "field" }, h("label", { class: "field-label", for: "batch-caption" }, "Caption for this batch"), batchCaption),
      h("div", { class: "field" }, h("span", { class: "field-label" }, "Area"), pills),
      h("hr", { class: "hairline" }),
      h("div", { class: "queue-head" }, summary, range),
      notice,
      queue,
    ),
    h("div", { class: "sticky-footer" }, uploadBtn),
  );

  window.addEventListener("beforeunload", (e) => {
    if (items.some((i) => i.status === "ready" || i.status === "working")) e.preventDefault();
  });

  function dropRow(item: Item): void {
    if (item.thumb.src.startsWith("blob:")) URL.revokeObjectURL(item.thumb.src);
    item.row.remove();
  }

  function renderPills(): void {
    if (adding) {
      pendingRender = true;
      return;
    }
    const all = area && !areas.includes(area) ? [area, ...areas] : areas;
    pills.replaceChildren(
      ...all.map((a) =>
        h("button", {
          type: "button",
          class: "pill",
          "aria-pressed": String(a === area),
          onclick: () => {
            area = a === area ? null : a;
            renderPills();
          },
        }, a),
      ),
      h("button", { type: "button", class: "pill pill-add", onclick: () => startAdd() }, "+ Add"),
    );
  }

  function startAdd(): void {
    const input = h("input", { class: "pill-input", type: "text", maxLength: 40, "aria-label": "New area", enterKeyHint: "done" });
    let closed = false;
    adding = true;
    const finish = (save: boolean) => {
      if (closed) return;
      closed = true;
      adding = false;
      pendingRender = false;
      const v = input.value.trim();
      if (save && v) area = v;
      renderPills();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    pills.lastElementChild?.replaceWith(input);
    input.focus();
  }

  async function loadAreas(): Promise<void> {
    const mine = ++areaRequest;
    const slug = getProject().slug;
    let list: string[] = [];
    try {
      list = (await api.areas(slug)).map((a) => a.area);
    } catch {
      // the pills fall back to "+ Add"; uploading still works
    }
    if (mine !== areaRequest) return; // a newer project's request superseded this one
    areas = list;
    renderPills();
  }

  function batchFinished(): boolean {
    return items.length > 0 && items.every((i) => i.status === "done" || i.status === "duplicate" || i.status === "unreadable");
  }

  function refresh(): void {
    const ready = items.filter((i) => i.status === "ready").length;
    uploadBtn.disabled = running || ready === 0;
    uploadBtn.textContent = ready === 0 ? "Upload" : `Upload ${plural(ready, "photo")}`;
    const shown = items.filter((i) => i.row.isConnected);
    const uploading = items.filter((i) => i.status === "working").length;
    const active = items.some((i) => i.status === "ready" || i.status === "working");
    if (!active && finished.done + finished.duplicate > 0) {
      const k = shown.filter((i) => i.status !== "done" && i.status !== "duplicate").length;
      summary.textContent = `Uploaded ${finished.done}${finished.duplicate ? ` · ${finished.duplicate} already uploaded` : ""}${k ? ` · ${k} need attention` : ""}`;
      range.textContent = "";
    } else if (shown.length > 0) {
      summary.textContent = `${plural(shown.length, "photo")}${uploading ? ` · ${uploading} uploading` : ""}`;
      range.textContent = timeRange(shown.map((i) => i.takenAt));
    } else if (finished.done + finished.duplicate > 0) {
      summary.textContent = `Uploaded ${finished.done}${finished.duplicate ? ` · ${finished.duplicate} already uploaded` : ""}`;
      range.textContent = "";
    } else {
      summary.textContent = "";
      range.textContent = "";
    }
  }

  function leave(item: Item): void {
    setTimeout(() => {
      item.row.classList.add("is-leaving");
      setTimeout(() => {
        dropRow(item);
        refresh();
      }, reducedMotion() ? 0 : FADE_MS);
    }, LEAVE_AFTER_MS);
  }

  function setStatus(item: Item, status: Status, detail?: string): void {
    item.status = status;
    item.statusText.textContent = detail ? `${LABEL[status]} — ${detail}` : LABEL[status];
    const error = status === "failed" || status === "unreadable" || status === "signin";
    item.statusText.className = `status-text${error ? " is-error" : status === "working" ? " is-active" : ""}`;
    item.progress.hidden = status !== "working";
    item.retry.hidden = status !== "failed" && status !== "signin";
    item.remove.hidden = status === "working" || status === "done" || status === "duplicate";
    if (status === "done") finished.done++;
    if (status === "duplicate") finished.duplicate++;
    if (status === "done" || status === "duplicate") leave(item);
    refresh();
  }

  function newItem(file: File): Item {
    const thumb = h("img", { class: "thumb", alt: "" });
    const caption = h("input", { class: "input", type: "text", maxLength: 280, placeholder: "Caption (overrides batch)", "aria-label": "Photo caption" });
    const statusText = h("span", { class: "status-text" });
    const fill = h("div", { class: "progress-fill" });
    const progress = h("div", { class: "progress", hidden: true, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, fill);
    const retry = h("button", { type: "button", class: "link-btn", hidden: true }, "Retry");
    const remove = h("button", { type: "button", class: "icon-btn", "aria-label": "Remove photo" }, icon("x", 18));
    const row = h("li", { class: "queue-row" }, thumb, h("div", { class: "row-main" }, caption, h("div", { class: "row-status" }, statusText, progress, retry)), remove);
    const item: Item = { file, takenAt: toOffsetIso(new Date(file.lastModified)), status: "ready", row, thumb, caption, statusText, progress, fill, retry, remove };
    retry.addEventListener("click", () => {
      setStatus(item, "ready");
      void runQueue();
    });
    remove.addEventListener("click", () => {
      const i = items.indexOf(item);
      if (i >= 0) items.splice(i, 1);
      dropRow(item);
      refresh();
    });
    queue.append(row);
    setStatus(item, "ready");
    return item;
  }

  async function addFiles(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length === 0) return;
    if (batchFinished()) {
      // Start a new batch: drop the finished one so its rows and counts don't carry over.
      for (const item of items) dropRow(item);
      items.length = 0;
      finished = { done: 0, duplicate: 0 };
    }
    const added = files.map((file) => newItem(file));
    items.push(...added);
    refresh();
    for (const item of added) {
      // One at a time keeps iOS memory down.
      if (!items.includes(item)) continue;
      item.takenAt = await captureTime(item.file);
      refresh();
      const url = await makeThumb(item.file);
      if (url) {
        if (items.includes(item) && item.row.isConnected) item.thumb.src = url;
        else URL.revokeObjectURL(url);
      }
    }
  }

  async function uploadOne(item: Item, project: ProjectSummary, batch: { caption: string; area: string | null }): Promise<void> {
    setStatus(item, "working");
    item.fill.style.width = "0%";
    try {
      item.processed ??= await processPhoto(item.file);
      item.takenAt = item.processed.takenAt;
      const caption = item.caption.value.trim() || batch.caption;
      const res = await uploadPhoto(project.slug, item.processed, { caption, area: batch.area }, (f) => {
        const pct = Math.round(f * 100);
        item.fill.style.width = `${pct}%`;
        item.progress.setAttribute("aria-valuenow", String(pct));
      });
      item.processed = undefined;
      setStatus(item, res.duplicate ? "duplicate" : "done");
    } catch (err) {
      if (err instanceof UnreadablePhotoError) setStatus(item, "unreadable");
      else if (err instanceof ApiError && err.code === "signin_required") setStatus(item, "signin");
      else setStatus(item, "failed", errorMessage(err));
    }
  }

  async function runQueue(): Promise<void> {
    if (running) return;
    running = true;
    notice.hidden = true;
    onRunningChange?.(true);
    refresh();
    const project = getProject();
    const batch = { caption: batchCaption.value.trim(), area }; // fixed for this run
    let next: Item | undefined;
    while ((next = items.find((i) => i.status === "ready"))) {
      await uploadOne(next, project, batch);
      if (next.status === "signin") {
        notice.hidden = false;
        break;
      }
    }
    running = false;
    onRunningChange?.(false);
    if (batchFinished()) batchCaption.value = "";
    refresh();
    void loadAreas();
  }

  renderPills();
  void loadAreas();
  refresh();

  return {
    projectChanged() {
      area = null;
      areas = [];
      renderPills();
      void loadAreas();
    },
  };
}
