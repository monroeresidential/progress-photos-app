import type { AdminPhoto } from "../shared/types";
import { api, ApiError, deleteNote, errorMessage } from "./api";
import { runBulk } from "./bulk";
import { h } from "./dom";
import { icon } from "./icons";
import { promptSheet } from "./sheet";

export const BULK_CONCURRENCY = 4;

export interface SelectFooterOptions {
  selected(): string[];
  photo(id: string): AdminPhoto | undefined;
  onUpdate(p: AdminPhoto): void;
  onRemove(id: string): void;
  onMessage(msg: string): void;
}

const plural = (n: number) => `${n} ${n === 1 ? "photo" : "photos"}`;

export function mountSelectFooter(o: SelectFooterOptions): { element: HTMLElement; refresh(): void } {
  let busy = false;
  const progress = h("p", { class: "select-progress tabular", role: "status" });
  const hideBtn = h("button", { type: "button", class: "btn btn-secondary" });
  const captionBtn = h("button", { type: "button", class: "btn btn-secondary" }, icon("pencil", 18), "Caption");
  const deleteBtn = h("button", { type: "button", class: "btn btn-secondary btn-danger" }, icon("trash-2", 18), "Delete");
  const element = h("div", { class: "sticky-footer" }, progress, h("div", { class: "select-footer" }, hideBtn, captionBtn, deleteBtn));

  const allHidden = () => {
    const ids = o.selected();
    return ids.length > 0 && ids.every((id) => o.photo(id)?.hidden);
  };

  function refresh(): void {
    const unhide = allHidden();
    hideBtn.replaceChildren(icon(unhide ? "eye" : "eye-off", 18), unhide ? "Unhide" : "Hide");
    for (const b of [hideBtn, captionBtn, deleteBtn]) b.disabled = busy || o.selected().length === 0;
  }

  async function bulk<T>(verb: string, fn: (id: string) => Promise<T>, apply: (id: string, value: T) => void): Promise<void> {
    const ids = o.selected();
    if (ids.length === 0) return;
    busy = true;
    refresh();
    progress.textContent = `${verb} 0 of ${ids.length}…`;
    const res = await runBulk(ids, BULK_CONCURRENCY, fn, (done, total) => (progress.textContent = `${verb} ${done} of ${total}…`));
    busy = false;
    progress.textContent = "";
    for (const { id, value } of res.ok) apply(id, value);
    if (res.failed.length > 0) {
      const signin = res.failed.some((f) => f.error instanceof ApiError && f.error.code === "signin_required");
      o.onMessage(
        signin
          ? errorMessage(new ApiError(401, "signin_required", "Sign-in expired"))
          : `${res.failed.length} couldn't be updated. They're still selected — tap the action again to retry.`,
      );
    }
    refresh();
  }

  hideBtn.addEventListener("click", () => {
    const target = !allHidden();
    void bulk(target ? "Hiding" : "Unhiding", (id) => api.patch(id, { hidden: target }), (_, p) => o.onUpdate(p));
  });
  captionBtn.addEventListener("click", async () => {
    const n = o.selected().length;
    const text = await promptSheet({ title: `Caption for ${plural(n)}`, confirm: `Apply to ${plural(n)}` });
    if (text === null) return;
    void bulk("Updating", (id) => api.patch(id, { caption: text.trim() || null }), (_, p) => o.onUpdate(p));
  });
  deleteBtn.addEventListener("click", () => {
    const n = o.selected().length;
    if (!confirm(`Delete ${plural(n)}? This can't be undone.`)) return;
    const notes = new Set<string>();
    void bulk(
      "Deleting",
      (id) => api.remove(id),
      (id, res) => {
        o.onRemove(id);
        const note = deleteNote(res);
        if (note) notes.add(note);
      },
    ).then(() => {
      if (notes.size > 0) o.onMessage([...notes].join(" "));
    });
  });

  refresh();
  return { element, refresh };
}
