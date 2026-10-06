export interface ProjectRow {
  slug: string;
  name: string;
  site_url: string;
  allowed_origins: string;
  created_at: string;
}

export function getProject(db: D1Database, slug: string) {
  return db.prepare("SELECT * FROM projects WHERE slug = ?").bind(slug).first<ProjectRow>();
}

export async function listProjects(db: D1Database): Promise<ProjectRow[]> {
  const { results } = await db.prepare("SELECT * FROM projects ORDER BY name").all<ProjectRow>();
  return results;
}

export function allowedOrigins(p: ProjectRow): string[] {
  try {
    const v: unknown = JSON.parse(p.allowed_origins);
    return Array.isArray(v) ? v.filter((o): o is string => typeof o === "string") : [];
  } catch {
    return [];
  }
}
