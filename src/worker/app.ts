import { Hono } from "hono";
import type { AppEnv, Deps } from "./env";
import { HttpError } from "./http";

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  void deps; // routes registered in later tasks use deps

  app.notFound((c) => c.json({ error: "not_found", message: "Not found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return c.json({ error: "internal", message: "Something went wrong" }, 500);
  });
  return app;
}
