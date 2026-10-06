import "./style.css";
import type { ProjectSummary } from "../shared/types";
import { api, errorMessage } from "./api";
import { h } from "./dom";
import { mountManage } from "./manage";
import { mountUpload } from "./upload";

const LAST_PROJECT = "progress-photos:last-project";
const root = document.getElementById("app")!;

const remembered = () => {
  try {
    return localStorage.getItem(LAST_PROJECT);
  } catch {
    return null;
  }
};
const remember = (slug: string) => {
  try {
    localStorage.setItem(LAST_PROJECT, slug);
  } catch {
    // private mode: not remembered
  }
};

async function start(): Promise<void> {
  root.replaceChildren(h("p", { class: "muted" }, "Loading projects…"));
  let projects: ProjectSummary[];
  try {
    projects = await api.projects();
  } catch (err) {
    root.replaceChildren(h("p", {}, errorMessage(err)), h("button", { onclick: () => location.reload() }, "Reload"));
    return;
  }
  if (projects.length === 0) {
    root.replaceChildren(h("p", {}, "No projects yet. Add one with npm run project:add."));
    return;
  }

  let current = projects.find((p) => p.slug === remembered()) ?? projects[0]!;
  const picker = h(
    "select",
    {
      id: "project",
      onchange: () => {
        current = projects.find((p) => p.slug === picker.value)!;
        remember(current.slug);
        if (!managePane.hidden) manage.reload();
      },
    },
    ...projects.map((p) => h("option", { value: p.slug, selected: p.slug === current.slug }, p.name)),
  );

  const uploadPane = h("section", { role: "tabpanel" });
  const managePane = h("section", { role: "tabpanel", hidden: true });
  mountUpload(uploadPane, () => current, (running) => (picker.disabled = running));
  const manage = mountManage(managePane, () => current);

  const uploadTab = h("button", { role: "tab", "aria-selected": "true" }, "Upload");
  const manageTab = h("button", { role: "tab", "aria-selected": "false" }, "Manage");
  const select = (showManage: boolean) => {
    uploadPane.hidden = showManage;
    managePane.hidden = !showManage;
    uploadTab.setAttribute("aria-selected", String(!showManage));
    manageTab.setAttribute("aria-selected", String(showManage));
    if (showManage) manage.reload();
  };
  uploadTab.addEventListener("click", () => select(false));
  manageTab.addEventListener("click", () => select(true));

  root.replaceChildren(
    h("header", {}, h("label", { class: "field", for: "project" }, "Project", picker), h("div", { class: "tabs", role: "tablist" }, uploadTab, manageTab)),
    uploadPane,
    managePane,
  );
}

void start();
