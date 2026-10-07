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

export function mountSelectFooter(o: SelectFooterOptions): { element: HTMLElement; refresh(): void; busy(): boolean } {
  let busy = false;
  /** The direction (true = Hide) of the last Hide/Unhide run while failures remain selected, so a retry goes the same way. */
  let pending: boolean | null = null;
  let pendingKey: string | null = null;
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
    // The selection changed by the user (not by our own run): the remembered direction no longer applies.
    if (pending !== null && pendingKey !== null && pendingKey !== o.selected().join(",")) pending = pendingKey = null;
    const unhide = !(pending ?? !allHidden());
    hideBtn.replaceChildren(icon(unhide ? "eye" : "eye-off", 18), unhide ? "Unhide" : "Hide");
    for (const b of [hideBtn, captionBtn, deleteBtn]) b.disabled = busy || o.selected().length === 0;
  }

  /** Runs fn over a snapshot of ids; returns the failure message ("" when all succeeded). */
  async function bulk<T>(ids: string[], verb: string, fn: (id: string) => Promise<T>, apply: (id: string, value: T) => void): Promise<string> {
    if (ids.length === 0) return "";
    busy = true;
    o.onMessage("");
    refresh();
    progress.textContent = `${verb} 0 of ${ids.length}…`;
    const res = await runBulk(ids, BULK_CONCURRENCY, fn, (done, total) => (progress.textContent = `${verb} ${done} of ${total}…`));
    busy = false;
    progress.textContent = "";
    for (const { id, value } of res.ok) apply(id, value);
    refresh();
    if (res.failed.length === 0) return "";
    const signin = res.failed.some((f) => f.error instanceof ApiError && f.error.code === "signin_required");
    return signin
      ? errorMessage(new ApiError(401, "signin_required", "Sign-in expired"))
      : `${res.failed.length} couldn't be updated. They're still selected — tap the action again to retry.`;
  }

  const say = (...parts: string[]) => {
    const msg = parts.filter(Boolean).join(" ");
    if (msg) o.onMessage(msg);
  };

  hideBtn.addEventListener("click", async () => {
    const ids = o.selected();
    const target = pending ?? !allHidden();
    pending = target;
    pendingKey = null; // our own updates below mustn't read as a user change
    const failure = await bulk(
      ids,
      target ? "Hiding" : "Unhiding",
      async (id) => {
        const p = o.photo(id);
        if (p && p.hidden === target) return p; // already in the target state: success, no PATCH
        return api.patch(id, { hidden: target });
      },
      (_, p) => o.onUpdate(p),
    );
    if (failure) pendingKey = o.selected().join(",");
    else pending = pendingKey = null;
    refresh();
    say(failure);
  });
  captionBtn.addEventListener("click", async () => {
    const ids = o.selected();
    if (ids.length === 0) return;
    const text = await promptSheet({ title: `Caption for ${plural(ids.length)}`, confirm: `Apply to ${plural(ids.length)}` });
    if (text === null) return;
    if (!text.trim() && !confirm(`Clear captions on ${plural(ids.length)}?`)) return;
    say(await bulk(ids, "Updating", (id) => api.patch(id, { caption: text.trim() || null }), (_, p) => o.onUpdate(p)));
  });
  deleteBtn.addEventListener("click", async () => {
    const ids = o.selected();
    if (ids.length === 0) return;
    if (!confirm(`Delete ${plural(ids.length)}? This can't be undone.`)) return;
    const notes = new Set<string>();
    const failure = await bulk(
      ids,
      "Deleting",
      (id) =>
        api.remove(id).catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return undefined; // already deleted elsewhere
          throw err;
        }),
      (id, res) => {
        o.onRemove(id);
        const note = deleteNote(res);
        if (note) notes.add(note);
      },
    );
    say(failure, ...notes);
  });

  refresh();
  return { element, refresh, busy: () => busy };
}
