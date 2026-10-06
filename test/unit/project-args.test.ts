import { describe, expect, it } from "vitest";
import { parseProjectArgs, projectInsertSql, wranglerD1Args } from "../../scripts/lib/project-args.ts";

describe("parseProjectArgs", () => {
  it("parses the spec's form", () => {
    expect(
      parseProjectArgs(["--env", "staging", "birken-lofts", "Birken Lofts", "https://birkenlofts.com/progress/", "https://birkenlofts.com", "http://localhost:3000"]),
    ).toEqual({
      target: "staging",
      slug: "birken-lofts",
      name: "Birken Lofts",
      siteUrl: "https://birkenlofts.com/progress/",
      origins: ["https://birkenlofts.com", "http://localhost:3000"],
    });
  });

  it.each([
    [["birken-lofts", "B", "https://b.com/", "https://b.com"], /--env is required/],
    [["--env", "prod", "birken-lofts", "B", "https://b.com/", "https://b.com"], /--env must be/],
    [["--env", "local", "Birken_Lofts", "B", "https://b.com/", "https://b.com"], /slug/],
    [["--env", "local", "birken-lofts", " ", "https://b.com/", "https://b.com"], /name/],
    [["--env", "local", "birken-lofts", "B", "birkenlofts.com", "https://b.com"], /site_url/],
    [["--env", "local", "birken-lofts", "B", "https://b.com/"], /at least one origin/],
    [["--env", "local", "birken-lofts", "B", "https://b.com/", "https://b.com/"], /not an origin/],
  ])("rejects %j", (argv, message) => {
    expect(() => parseProjectArgs(argv)).toThrow(message);
  });
});

describe("projectInsertSql", () => {
  it("escapes quotes in every literal", () => {
    const sql = projectInsertSql(
      { slug: "ohare", name: "O'Hare Lofts", siteUrl: "https://o.com/p/", origins: ["https://o.com"] },
      "2026-10-06T00:00:00.000Z",
    );
    expect(sql).toBe(
      `INSERT INTO projects (slug, name, site_url, allowed_origins, created_at) VALUES ('ohare', 'O''Hare Lofts', 'https://o.com/p/', '["https://o.com"]', '2026-10-06T00:00:00.000Z');`,
    );
  });
});

describe("wranglerD1Args", () => {
  it("targets the right database", () => {
    expect(wranglerD1Args("local")).toEqual(["d1", "execute", "progress-photos", "--local"]);
    expect(wranglerD1Args("staging")).toEqual(["d1", "execute", "progress-photos-staging", "--remote", "--env", "staging"]);
    expect(wranglerD1Args("production")).toEqual(["d1", "execute", "progress-photos", "--remote"]);
  });
});
