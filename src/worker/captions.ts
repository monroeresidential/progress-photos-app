import { badRequest } from "./http";

export const MAX_CAPTION = 280;

export function normalizeCaption(s: string): string | null {
  const t = s.trim();
  if (t === "") return null;
  if ([...t].length > MAX_CAPTION) throw badRequest(`Caption must be ${MAX_CAPTION} characters or fewer`);
  return t;
}
