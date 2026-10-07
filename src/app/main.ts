import "./theme.css";
import type { ProjectSummary } from "../shared/types";
import { api, errorMessage } from "./api";
import { h } from "./dom";
import { mountHeader, type Tab } from "./header";
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
  root.replaceChildren(h("p", { class: "manage-status" }, "Loading projects…"));
  let projects: ProjectSummary[];
  try {
    projects = await api.projects();
  } catch (err) {
    root.replaceChildren(h("p", { class: "manage-status" }, errorMessage(err)), h("button", { class: "btn btn-secondary manage-more", onclick: () => location.reload() }, "Reload"));
    return;
  }
  if (projects.length === 0) {
    root.replaceChildren(h("p", { class: "manage-status" }, "No projects yet. Add one with npm run project:add."));
    return;
  }

  let current = projects.find((p) => p.slug === remembered()) ?? projects[0]!;
  const uploadPane = h("section", { role: "tabpanel" });
  const managePane = h("section", { role: "tabpanel", hidden: true });

  const header = mountHeader({
    projects,
    initial: current,
    onProject: (p) => {
      current = p;
      remember(p.slug);
      upload.projectChanged();
      manage.cancelSelect();
      if (!managePane.hidden) manage.reload();
    },
    onTab: (t) => show(t),
    onSelectStart: () => manage.startSelect(),
    onSelectCancel: () => manage.cancelSelect(),
    onSelectAll: () => manage.toggleAll(),
  });
  const upload = mountUpload(uploadPane, () => current, (running) => header.setLocked(running));
  const manage = mountManage(managePane, { getProject: () => current, onSelectChange: header.setSelect });

  function show(t: Tab): void {
    if (t === "upload") manage.cancelSelect();
    const enteringManage = t === "manage" && managePane.hidden;
    uploadPane.hidden = t !== "upload";
    managePane.hidden = t !== "manage";
    header.setTab(t);
    if (enteringManage) manage.reload();
  }

  root.replaceChildren(header.element, uploadPane, managePane);
}

void start();
