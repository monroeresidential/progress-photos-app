import type { AdminPhoto, ApiErrorBody, FeedPage, ProjectSummary } from "../shared/types";
import type { Processed } from "./lib/process";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const signinRequired = () => new ApiError(401, "signin_required", "Sign-in expired");

/** Access answers an expired session with a redirect to its login page (or a 401). */
export function interpretProbe(res: { type: string; status: number }): "signin" | "ok" {
  return res.type === "opaqueredirect" || res.status === 401 ? "signin" : "ok";
}

export async function probeSession(): Promise<"signin" | "ok" | "unreachable"> {
  try {
    return interpretProbe(await fetch("/api/admin/projects", { redirect: "manual", cache: "no-store" }));
  } catch {
    return "unreachable";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, redirect: "manual" });
  } catch {
    throw new ApiError(0, "network", "Network error — check your connection and retry");
  }
  if (interpretProbe(res) === "signin") throw signinRequired();
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(res.status, body?.error ?? "http_error", body?.message ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  projects: () => request<ProjectSummary[]>("/api/admin/projects"),
  photos: (project: string, cursor?: string) =>
    request<FeedPage<AdminPhoto>>(`/api/admin/photos?project=${encodeURIComponent(project)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
  patch: (id: string, body: { caption?: string | null; hidden?: boolean }) =>
    request<AdminPhoto>(`/api/admin/photos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  remove: (id: string) => request<{ purged: false } | undefined>(`/api/admin/photos/${id}`, { method: "DELETE" }),
};

/** XHR rather than fetch so the UI gets upload progress. */
export function uploadPhoto(
  project: string,
  p: Processed,
  caption: string,
  onProgress: (fraction: number) => void,
): Promise<{ id: string; duplicate?: boolean }> {
  const form = new FormData();
  form.set("project", project);
  form.set("fingerprint", p.fingerprint);
  form.set("takenAt", p.takenAt);
  if (caption) form.set("caption", caption);
  form.set("width", String(p.width));
  form.set("height", String(p.height));
  for (const v of p.variants) form.set(`w${v.width}`, v.blob, `${v.width}.webp`);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/photos");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON (e.g. an Access login page)
      }
      if (xhr.status === 200 || xhr.status === 201) {
        if (body && typeof body === "object" && "id" in body) resolve(body as { id: string; duplicate?: boolean });
        else reject(signinRequired());
      } else if (xhr.status === 401) {
        reject(signinRequired());
      } else {
        const e = body as ApiErrorBody | null;
        reject(new ApiError(xhr.status, e?.error ?? "http_error", e?.message ?? `HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      void probeSession().then((s) =>
        reject(s === "signin" ? signinRequired() : new ApiError(0, "network", "Network error — check your connection and retry")),
      );
    };
    xhr.send(form);
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "signin_required") return "Your sign-in expired. Reload the page to sign in again.";
  return err instanceof Error ? err.message : String(err);
}
