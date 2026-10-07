import { dayKey } from "../embed/days";

/** Descriptive alt text: "{Project} – {Area} – {Caption}", dropping empty parts; falls back to the date taken. */
export function photoAlt(projectName: string, p: { caption: string | null; area: string | null; takenAt: string }, locale?: string): string {
  const caption = p.caption?.trim() ?? "";
  const area = p.area?.trim() ?? "";
  const repeatsArea = area !== "" && caption.toLocaleLowerCase().startsWith(area.toLocaleLowerCase());
  const parts = [projectName, repeatsArea ? "" : area, caption].filter((s) => s !== "");
  if (parts.length > 1) return parts.join(" – ");
  const date = new Intl.DateTimeFormat(locale ?? "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${dayKey(p.takenAt)}T00:00:00Z`),
  );
  return `${projectName} construction progress, ${date}`;
}
