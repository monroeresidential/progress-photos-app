import type { ProjectSummary } from "../shared/types";
import { h } from "./dom";
import { icon } from "./icons";

export type Tab = "upload" | "manage";

export interface SelectState {
  count: number;
  allSelected: boolean;
}

export interface HeaderOptions {
  projects: ProjectSummary[];
  initial: ProjectSummary;
  onProject(p: ProjectSummary): void;
  onTab(tab: Tab): void;
  onSelectStart(): void;
  onSelectCancel(): void;
  onSelectAll(): void;
}

export interface Header {
  element: HTMLElement;
  setTab(tab: Tab): void;
  setLocked(locked: boolean): void;
  setSelect(state: SelectState | null): void;
}

export function safeHttp(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

export function mountHeader(o: HeaderOptions): Header {
  let current = o.initial;
  let tab: Tab = "upload";

  const name = h("span", { class: "name" }, current.name);
  const picker = h(
    "select",
    {
      "aria-label": "Project",
      onchange: () => {
        current = o.projects.find((p) => p.slug === picker.value)!;
        name.textContent = current.name;
        renderRight();
        o.onProject(current);
      },
    },
    ...o.projects.map((p) => h("option", { value: p.slug, selected: p.slug === current.slug }, p.name)),
  );
  const right = h("div", { class: "header-right" });
  const projectRow = h("div", { class: "project-row" }, h("label", { class: "project-picker" }, name, icon("chevron-down", 18), picker), right);
  const selectRow = h("div", { class: "project-row", hidden: true });
  const uploadTab = h("button", { type: "button", role: "tab", "aria-selected": "true", onclick: () => o.onTab("upload") }, "Upload");
  const manageTab = h("button", { type: "button", role: "tab", "aria-selected": "false", onclick: () => o.onTab("manage") }, "Manage");
  const element = h(
    "header",
    { class: "app-header" },
    h("h1", { class: "app-title" }, "Monroe Residential Progress Photos"),
    projectRow,
    selectRow,
    h("div", { class: "seg", role: "tablist" }, uploadTab, manageTab),
  );

  function renderRight(): void {
    if (tab === "manage") {
      right.replaceChildren(h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => o.onSelectStart() }, "Select"));
    } else if (safeHttp(current.siteUrl)) {
      right.replaceChildren(h("a", { class: "btn btn-secondary btn-sm", href: current.siteUrl, target: "_blank", rel: "noopener" }, "Live site", icon("external-link", 16)));
    } else {
      right.replaceChildren();
    }
  }
  renderRight();

  return {
    element,
    setTab(t) {
      tab = t;
      uploadTab.setAttribute("aria-selected", String(t === "upload"));
      manageTab.setAttribute("aria-selected", String(t === "manage"));
      renderRight();
    },
    setLocked(locked) {
      picker.disabled = locked;
    },
    setSelect(state) {
      projectRow.hidden = state !== null;
      selectRow.hidden = state === null;
      if (!state) return selectRow.replaceChildren();
      selectRow.replaceChildren(
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => o.onSelectCancel() }, "Cancel"),
        h("span", { class: "select-title tabular", role: "status" }, `${state.count} selected`),
        h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => o.onSelectAll() }, state.allSelected ? "None" : "All"),
      );
    },
  };
}
