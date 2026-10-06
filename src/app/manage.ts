import { smallestSrc } from "../shared/srcset";
import type { AdminPhoto, ProjectSummary } from "../shared/types";
import { api, errorMessage } from "./api";
import { h } from "./dom";

export function mountManage(container: HTMLElement, getProject: () => ProjectSummary): { reload(): void } {
  const list = h("ul");
  const status = h("p", { class: "muted", role: "status" });
  const more = h("button", { hidden: true, onclick: () => void load(false) }, "Load more");
  container.replaceChildren(list, status, more);
  let cursor: string | null = null;
  let generation = 0;

  async function load(reset: boolean): Promise<void> {
    const mine = reset ? ++generation : generation;
    if (reset) {
      list.replaceChildren();
      cursor = null;
    }
    more.hidden = true;
    status.textContent = "Loading…";
    try {
      const page = await api.photos(getProject().slug, cursor ?? undefined);
      if (mine !== generation) return;
      for (const p of page.photos) list.append(card(p));
      cursor = page.nextCursor;
      more.hidden = cursor === null;
      status.textContent = list.childElementCount === 0 ? "No photos yet." : "";
    } catch (err) {
      if (mine === generation) status.textContent = errorMessage(err);
    }
  }

  function card(initial: AdminPhoto): HTMLLIElement {
    let photo = initial;
    const caption = h("input", { type: "text", value: photo.caption ?? "", maxLength: 280, "aria-label": "Caption" });
    const note = h("span", { class: "muted" });
    const li = h("li", { class: photo.hidden ? "card hidden-photo" : "card" });
    const hide = h("button", {}, photo.hidden ? "Unhide" : "Hide");

    const buttons: HTMLButtonElement[] = [];
    async function act(fn: () => Promise<void>): Promise<void> {
      note.textContent = "";
      for (const b of buttons) b.disabled = true;
      try {
        await fn();
      } catch (err) {
        note.textContent = errorMessage(err);
      } finally {
        for (const b of buttons) b.disabled = false;
      }
    }

    const save = h("button", {
      onclick: () =>
        act(async () => {
          photo = await api.patch(photo.id, { caption: caption.value.trim() || null });
          caption.value = photo.caption ?? "";
          note.textContent = "Saved";
        }),
    }, "Save");
    hide.addEventListener("click", () =>
      act(async () => {
        photo = await api.patch(photo.id, { hidden: !photo.hidden });
        li.className = photo.hidden ? "card hidden-photo" : "card";
        hide.textContent = photo.hidden ? "Unhide" : "Hide";
      }),
    );
    const del = h("button", {
      onclick: () =>
        act(async () => {
          if (!confirm("Delete this photo? This can't be undone.")) return;
          const res = await api.remove(photo.id);
          li.remove();
          if (res?.purged === false || res?.objectsDeleted === false) status.textContent = "Deleted. Cached copies may take a minute to disappear.";
          if (list.childElementCount === 0 && cursor === null) status.textContent = "No photos yet.";
        }),
    }, "Delete");

    buttons.push(save, hide, del);
    li.append(
      h("img", { src: smallestSrc(photo.srcset), alt: "", loading: "lazy" }),
      h("div", { class: "meta" }, h("span", { class: "muted" }, new Date(photo.takenAt).toLocaleString()), caption, h("div", { class: "row" }, save, hide, del), note),
    );
    return li;
  }

  return { reload: () => void load(true) };
}
