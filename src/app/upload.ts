import type { ProjectSummary } from "../shared/types";
import { ApiError, errorMessage, uploadPhoto } from "./api";
import { h } from "./dom";
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

interface Item {
  file: File;
  status: Status;
  processed?: Processed;
  li: HTMLLIElement;
  thumb: HTMLImageElement;
  caption: HTMLInputElement;
  statusText: HTMLSpanElement;
  progress: HTMLProgressElement;
  retry: HTMLButtonElement;
  remove: HTMLButtonElement;
}

export function mountUpload(container: HTMLElement, getProject: () => ProjectSummary, onRunningChange?: (running: boolean) => void): void {
  const items: Item[] = [];
  let running = false;

  const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, hidden: true, onchange: () => void addFiles() });
  const batchCaption = h("input", { type: "text", maxLength: 280, placeholder: "Optional" });
  const list = h("ul");
  const uploadBtn = h("button", { class: "primary", disabled: true, onclick: () => void runQueue() }, "Upload");
  const summary = h("p", { class: "summary" });
  const notice = h("p", { class: "notice", hidden: true }, "Your sign-in expired. ", h("a", { href: "/", target: "_blank", rel: "noopener" }, "Sign in again"), " If Retry still fails, close and reopen the app.");

  container.replaceChildren(
    h("button", { class: "add", onclick: () => fileInput.click() }, "Add photos"),
    fileInput,
    h("label", { class: "field" }, "Caption for this batch", batchCaption),
    notice,
    list,
    uploadBtn,
    summary,
  );

  window.addEventListener("beforeunload", (e) => {
    if (items.some((i) => i.status === "ready" || i.status === "working")) e.preventDefault();
  });

  function refresh(): void {
    uploadBtn.disabled = running || !items.some((i) => i.status === "ready");
  }

  function setStatus(item: Item, status: Status, detail?: string): void {
    item.status = status;
    item.statusText.textContent = detail ? `${LABEL[status]} — ${detail}` : LABEL[status];
    item.statusText.className = status === "failed" || status === "unreadable" || status === "signin" ? "status-text error" : "status-text";
    item.progress.hidden = status !== "working";
    item.retry.hidden = status !== "failed" && status !== "signin";
    item.remove.hidden = status !== "ready";
    refresh();
  }

  async function addFiles(): Promise<void> {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = "";
    summary.textContent = "";
    const added = files.map((file) => {
      const item = {
        file,
        status: "ready",
        thumb: h("img", { alt: "" }),
        caption: h("input", { type: "text", maxLength: 280, placeholder: "Caption (overrides batch)", "aria-label": "Photo caption" }),
        statusText: h("span", { class: "status-text" }),
        progress: h("progress", { max: 1, value: 0, hidden: true }),
        retry: h("button", { hidden: true }, "Retry"),
        remove: h("button", {}, "Remove"),
      } as Omit<Item, "li"> as Item;
      item.li = h("li", { class: "item" }, item.thumb, h("div", { class: "meta" }, item.caption, item.statusText, item.progress, h("div", {}, item.retry, item.remove)));
      item.retry.addEventListener("click", () => {
        setStatus(item, "ready");
        void runQueue();
      });
      item.remove.addEventListener("click", () => {
        items.splice(items.indexOf(item), 1);
        item.li.remove();
        refresh();
      });
      setStatus(item, "ready");
      list.append(item.li);
      return item;
    });
    items.push(...added);
    refresh();
    for (const item of added) {
      const url = await makeThumb(item.file); // one at a time keeps iOS memory down
      if (url) item.thumb.src = url;
    }
  }

  async function uploadOne(item: Item, project: ProjectSummary): Promise<void> {
    setStatus(item, "working");
    item.progress.value = 0;
    try {
      item.processed ??= await processPhoto(item.file);
      const caption = item.caption.value.trim() || batchCaption.value.trim();
      const res = await uploadPhoto(project.slug, item.processed, caption, (f) => (item.progress.value = f));
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
    let next: Item | undefined;
    while ((next = items.find((i) => i.status === "ready"))) {
      await uploadOne(next, project);
      if (next.status === "signin") {
        notice.hidden = false;
        break;
      }
    }
    running = false;
    onRunningChange?.(false);
    refresh();
    const published = items.filter((i) => i.status === "done" || i.status === "duplicate").length;
    summary.replaceChildren(`${published} of ${items.length} published. `, (safeHttp(project.siteUrl) ? h("a", { href: project.siteUrl, target: "_blank", rel: "noopener" }, "View on site") : ""));
  }
}

function safeHttp(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}
