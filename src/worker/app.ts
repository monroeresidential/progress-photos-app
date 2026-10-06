import { Hono } from "hono";
import { createAccessVerifier, requireAccess } from "./access";
import type { AppEnv, Deps } from "./env";
import { HttpError } from "./http";
import { registerFeed } from "./routes/feed";
import { registerImages } from "./routes/img";
import { registerUpload } from "./routes/upload";

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use("/api/admin/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/api/admin/*", requireAccess(createAccessVerifier(deps.fetch)));
  app.get("/api/admin/whoami", (c) => c.json({ email: c.var.email }));

  registerFeed(app, deps);
  registerImages(app, deps);
  registerUpload(app, deps);

  app.notFound((c) => c.json({ error: "not_found", message: "Not found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
    console.error(err);
    return c.json({ error: "internal", message: "Something went wrong" }, 500);
  });
  return app;
}
