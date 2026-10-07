import { photoAlt } from "../shared/alt";
import { smallestSrc, srcsetAttr } from "../shared/srcset";
import type { AdminPhoto, ProjectSummary } from "../shared/types";
import { api, deleteNote, errorMessage } from "./api";
import { dayCounts, dayLabel, groupByDay, timeLabel } from "./days";
import { h } from "./dom";
import type { SelectState } from "./header";
import { icon } from "./icons";
import { mountSelectFooter } from "./select";
import { openSheet } from "./sheet";
import { openViewer } from "./viewer";

export interface ManageOptions {
  getProject(): ProjectSummary;
  onSelectChange(state: SelectState | null): void;
}

export interface ManageTab {
  reload(): void;
  startSelect(): void;
  cancelSelect(): void;
  toggleAll(): void;
  isBusy(): boolean;
}

export function mountManage(container: HTMLElement, o: ManageOptions): ManageTab {
  let photos: AdminPhoto[] = [];
  /** Photos in display order (by day group), which is also the viewer's order. */
  let ordered: AdminPhoto[] = [];
  let cursor: string | null = null;
  let generation = 0;
  let loading = false;
  let selecting = false;
  const selection = new Set<string>();

  const body = h("div", { class: "manage-body" });
  const status = h("p", { class: "manage-status", role: "status" });
  const retry = h("button", { type: "button", class: "btn btn-secondary manage-more", hidden: true, onclick: () => void load(photos.length === 0).catch(() => {}) }, "Retry");
  const more = h("button", { type: "button", class: "btn btn-secondary manage-more", hidden: true, onclick: () => void load(false).catch(() => {}) }, "Load more");
  container.replaceChildren(body, status, retry, more);

  const footer = mountSelectFooter({
    selected: () => [...selection],
    photo: (id) => photos.find((p) => p.id === id),
    onUpdate: (p) => {
      selection.delete(p.id); // successes leave the selection; failures stay for a retry
      replace(p);
      emitSelect();
    },
    onRemove: (id) => removePhoto(id),
    onMessage: (msg) => showNote(msg),
  });
  footer.element.hidden = true;
  // Direct child of the flex-column container so position: sticky pins to the viewport bottom.
  container.append(footer.element);

  function emitSelect(): void {
    o.onSelectChange(selecting ? { count: selection.size, allSelected: photos.length > 0 && selection.size === photos.length } : null);
    footer.element.hidden = !selecting;
    footer.refresh();
  }

  function card(p: AdminPhoto): HTMLLIElement {
    const selected = selection.has(p.id);
    const img = h("img", { alt: photoAlt(o.getProject().name, p), loading: "lazy", decoding: "async" });
    img.sizes = "(min-width: 600px) 560px, 100vw";
    img.srcset = srcsetAttr(p.srcset);
    img.src = smallestSrc(p.srcset);
    const photoBtn = h(
      "button",
      {
        type: "button",
        class: "card-photo",
        "aria-label": selecting ? `${selected ? "Deselect" : "Select"} photo taken ${timeLabel(p.takenAt)}` : `Open photo taken ${timeLabel(p.takenAt)}`,
        onclick: () => (selecting ? toggle(p.id) : view(p.id)),
      },
      img,
      p.hidden ? h("span", { class: "hidden-tag" }, icon("eye-off", 14), "Hidden from site") : null,
      selecting ? h("span", { class: "check", "aria-hidden": "true" }, selected ? icon("check", 14) : null) : null,
    );
    if (selecting) photoBtn.setAttribute("aria-pressed", String(selected));
    const meta = [timeLabel(p.takenAt), p.area].filter(Boolean).join(" · ");
    return h(
      "li",
      { class: `card${p.hidden ? " is-hidden" : ""}${selected ? " is-selected" : ""}`, "data-id": p.id },
      photoBtn,
      h(
        "div",
        { class: "card-info" },
        h("div", {}, h("div", { class: "card-caption" }, p.caption ?? ""), h("div", { class: "card-meta tabular" }, meta)),
        selecting ? h("span") : h("button", { type: "button", class: "icon-btn", "aria-label": "More actions", onclick: () => actions(p) }, icon("more-horizontal", 20)),
      ),
    );
  }

  function render(): void {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusId = active && body.contains(active) ? active.closest<HTMLElement>("[data-id]")?.dataset.id ?? null : null;
    const focusMore = !!active?.closest(".icon-btn");
    const idsBefore = ordered.map((x) => x.id);
    renderBody();
    if (focusId) restoreFocus(focusId, focusMore, idsBefore);
  }

  function restoreFocus(id: string, more: boolean, idsBefore: string[]): void {
    const find = (x: string, m: boolean) => body.querySelector<HTMLElement>(`[data-id="${x}"] ${m ? ".icon-btn" : ".card-photo"}`);
    let target = find(id, more) ?? find(id, false);
    if (!target) {
      const pos = idsBefore.indexOf(id);
      const present = new Set(ordered.map((x) => x.id));
      const next = idsBefore.slice(pos + 1).find((x) => present.has(x));
      const prev = idsBefore.slice(0, Math.max(pos, 0)).reverse().find((x) => present.has(x));
      const pick = next ?? prev;
      target = pick ? find(pick, false) : null;
    }
    target?.focus();
  }

  function renderBody(): void {
    const groups = groupByDay(photos);
    ordered = groups.flatMap((g) => g.photos);
    body.replaceChildren(
      ...groups.map((g) =>
        h(
          "section",
          { class: "day" },
          h("div", { class: "day-head" }, h("h2", { class: "day-title" }, dayLabel(g.key)), h("span", { class: "day-counts tabular" }, dayCounts(g.photos))),
          h("ul", { class: "cards" }, ...g.photos.map((p) => card(p))),
        ),
      ),
    );
    if (!loading && photos.length === 0 && !status.textContent) status.textContent = "No photos yet.";
    if (photos.length > 0 && status.textContent === "No photos yet.") status.textContent = "";
  }

  let inFlight: Promise<void> | null = null;

  function load(reset: boolean): Promise<void> {
    if (!reset && inFlight) return inFlight;
    const p = doLoad(reset);
    inFlight = p;
    const clear = () => {
      if (inFlight === p) inFlight = null;
    };
    p.then(clear, clear); // handled here; callers get the rejection from `p` itself
    return p;
  }

  /** Rejects when the page request fails (Manage shows its own status and Retry too), so a caller such as the viewer can report it. */
  async function doLoad(reset: boolean): Promise<void> {
    const mine = reset ? ++generation : generation;
    if (reset) {
      photos = [];
      cursor = null;
      selection.clear();
    }
    loading = true;
    more.hidden = true;
    retry.hidden = true;
    status.textContent = "Loading…";
    render();
    try {
      const page = await api.photos(o.getProject().slug, cursor ?? undefined);
      if (mine !== generation) return;
      photos = [...photos, ...page.photos];
      cursor = page.nextCursor;
      status.textContent = "";
    } catch (err) {
      if (mine !== generation) return;
      status.textContent = errorMessage(err);
      retry.hidden = false;
      throw err;
    } finally {
      if (mine === generation) {
        loading = false;
        more.hidden = cursor === null;
        render();
        emitSelect();
      }
    }
  }

  let viewerSync: (() => void) | null = null;

  function replace(p: AdminPhoto): void {
    photos = photos.map((x) => (x.id === p.id ? p : x));
    render();
    viewerSync?.();
  }

  function removePhoto(id: string): void {
    photos = photos.filter((x) => x.id !== id);
    selection.delete(id);
    render();
    emitSelect();
    viewerSync?.();
  }

  /** Shows a message without hiding the empty-list state. */
  function showNote(note: string): void {
    const empty = photos.length === 0 && cursor === null ? "No photos yet." : "";
    status.textContent = [note, empty].filter(Boolean).join(" ");
  }

  async function run(fn: () => Promise<void>): Promise<void> {
    status.textContent = "";
    try {
      await fn();
    } catch (err) {
      status.textContent = errorMessage(err);
    }
  }

  /** Opens by id and resolves the position now: the list may have changed since the card or sheet was built. */
  function view(id: string): void {
    const index = ordered.findIndex((x) => x.id === id);
    if (index < 0) return;
    viewerSync = openViewer({
      projectName: o.getProject().name,
      photos: () => ordered,
      index,
      hasMore: () => cursor !== null,
      loadMore: () => load(false),
      onUpdate: replace,
      onDelete: (id: string, note: string) => {
        removePhoto(id);
        showNote(note);
      },
      returnFocus: (id: string) => body.querySelector<HTMLElement>(`[data-id="${id}"] .card-photo`),
    }).sync;
  }

  function actions(p: AdminPhoto): void {
    openSheet([
      { label: "Edit caption", icon: "pencil", onSelect: () => view(p.id) },
      {
        label: p.hidden ? "Unhide" : "Hide",
        icon: p.hidden ? "eye" : "eye-off",
        onSelect: () => void run(async () => replace(await api.patch(p.id, { hidden: !p.hidden }))),
      },
      {
        label: "Delete",
        icon: "trash-2",
        danger: true,
        onSelect: () =>
          void run(async () => {
            if (!confirm("Delete this photo? This can't be undone.")) return;
            const res = await api.remove(p.id);
            removePhoto(p.id);
            showNote(deleteNote(res));
          }),
      },
    ]);
  }

  function toggle(id: string): void {
    if (footer.busy()) return;
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    render();
    emitSelect();
  }

  return {
    reload: () => void load(true).catch(() => {}),
    isBusy: () => footer.busy(),
    startSelect() {
      selecting = true;
      selection.clear();
      render();
      emitSelect();
    },
    cancelSelect() {
      if (!selecting || footer.busy()) return;
      selecting = false;
      selection.clear();
      render();
      emitSelect();
    },
    toggleAll() {
      if (footer.busy()) return;
      if (selection.size === photos.length) selection.clear();
      else for (const p of photos) selection.add(p.id);
      render();
      emitSelect();
    },
  };
}
