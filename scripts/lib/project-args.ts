export type Target = "local" | "staging" | "production";

export interface ProjectInput {
  target: Target;
  slug: string;
  name: string;
  siteUrl: string;
  origins: string[];
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseProjectArgs(argv: string[]): ProjectInput {
  const args = [...argv];
  const i = args.indexOf("--env");
  if (i < 0) throw new Error("--env is required (local, staging or production)");
  const target = args[i + 1];
  if (target !== "local" && target !== "staging" && target !== "production") throw new Error("--env must be local, staging or production");
  args.splice(i, 2);

  const [slug, name, siteUrl, ...origins] = args;
  if (!slug || !SLUG.test(slug)) throw new Error("slug must be lowercase words joined by hyphens, e.g. birken-lofts");
  if (!name || !name.trim()) throw new Error("name is required");
  if (!siteUrl || !isHttpUrl(siteUrl)) throw new Error("site_url must be an http(s) URL");
  if (origins.length === 0) throw new Error("at least one origin is required");
  for (const o of origins) {
    if (!isHttpUrl(o) || new URL(o).origin !== o) throw new Error(`"${o}" is not an origin (scheme://host[:port], no path or trailing slash)`);
  }
  return { target, slug, name: name.trim(), siteUrl, origins };
}

export function sqlString(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

export function projectInsertSql(p: Omit<ProjectInput, "target">, createdAt: string): string {
  return `INSERT INTO projects (slug, name, site_url, allowed_origins, created_at) VALUES (${sqlString(p.slug)}, ${sqlString(p.name)}, ${sqlString(p.siteUrl)}, ${sqlString(JSON.stringify(p.origins))}, ${sqlString(createdAt)});`;
}

export function wranglerD1Args(target: Target): string[] {
  if (target === "local") return ["d1", "execute", "progress-photos", "--local"];
  if (target === "staging") return ["d1", "execute", "progress-photos-staging", "--remote", "--env", "staging"];
  return ["d1", "execute", "progress-photos", "--remote"];
}
