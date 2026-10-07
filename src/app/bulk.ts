import { ApiError } from "./api";

export interface BulkResult<T> {
  ok: { id: string; value: T }[];
  failed: { id: string; error: unknown }[];
}

const isSignin = (e: unknown) => e instanceof ApiError && e.code === "signin_required";

/** Runs fn for each id, at most `limit` at a time. Never rejects; stops starting work after a sign-in error. */
export async function runBulk<T>(
  ids: string[],
  limit: number,
  fn: (id: string) => Promise<T>,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkResult<T>> {
  const result: BulkResult<T> = { ok: [], failed: [] };
  let next = 0;
  let done = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < ids.length) {
      const id = ids[next++]!;
      try {
        result.ok.push({ id, value: await fn(id) });
      } catch (error) {
        result.failed.push({ id, error });
        if (isSignin(error)) stopped = true;
      }
      onProgress?.(++done, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, worker));
  for (const id of ids.slice(next)) result.failed.push({ id, error: new ApiError(401, "signin_required", "Sign-in expired") });
  return result;
}
