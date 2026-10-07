import { h } from "./dom";
import { icon, type IconName } from "./icons";

export interface SheetAction {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect(): void;
}

function present(content: HTMLElement[], onClose?: () => void): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, ...content);
  const backdrop = h("div", { class: "sheet-backdrop" }, sheet);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      const items = [...sheet.querySelectorAll<HTMLElement>("button:not(:disabled), input")];
      if (items.length === 0) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      if (i === -1) {
        e.preventDefault();
        items[0]!.focus();
      } else if (e.shiftKey && i === 0) {
        e.preventDefault();
        items[items.length - 1]!.focus();
      } else if (!e.shiftKey && i === items.length - 1) {
        e.preventDefault();
        items[0]!.focus();
      }
    }
  };
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    opener?.focus();
    onClose?.();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  sheet.querySelector<HTMLElement>("input, button")?.focus();
  return close;
}

export function openSheet(actions: SheetAction[]): void {
  const buttons = actions.map((a) =>
    h("button", { type: "button", class: `btn btn-secondary${a.danger ? " btn-danger" : ""}` }, a.icon ? icon(a.icon, 18) : null, a.label),
  );
  const cancel = h("button", { type: "button", class: "btn btn-ghost" }, "Cancel");
  const close = present([...buttons, cancel]);
  buttons.forEach((b, i) =>
    b.addEventListener("click", () => {
      close();
      actions[i]!.onSelect();
    }),
  );
  cancel.addEventListener("click", () => close());
}

export function promptSheet(o: { title: string; confirm: string; initial?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = h("input", { class: "input", type: "text", maxLength: 280, value: o.initial ?? "", "aria-label": o.title });
    const cancel = h("button", { type: "button", class: "btn btn-ghost" }, "Cancel");
    const form = h(
      "form",
      { class: "sheet-form" },
      h("p", { class: "sheet-title" }, o.title),
      input,
      h("button", { type: "submit", class: "btn btn-primary" }, o.confirm),
      cancel,
    );
    const close = present([form], () => resolve(result));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      result = input.value;
      close();
    });
    cancel.addEventListener("click", () => close());
  });
}
