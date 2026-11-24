import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// convex/lib imports siblings without a .ts extension (bundler style). Teach
// Node's loader to try ".ts" so we can exercise the real resolver here.
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) {
      try { return await next(s, c); } catch (e) {
        if (s.startsWith(".") && !/\\.[cm]?[jt]s$/.test(s)) return next(s + ".ts", c);
        throw e;
      }
    }`),
);
const { resolveWith } = await import("../convex/lib/core.ts");
type LinkLite = import("../convex/lib/core.ts").LinkLite;
type Source = import("../convex/lib/core.ts").Source;

function source(links: Record<string, Record<string, string>>): Source {
  return {
    user: { id: "u1", vars: { github: "mwufi" }, fallbackSearch: "google", llmEnabled: false, llmMy: false },
    scopes: ["u1", "t1", "global"],
    teamVars: () => ({}),
    link: (scopeId, keyword): LinkLite | null => {
      const url = links[scopeId]?.[keyword];
      if (!url) return null;
      return { id: `${scopeId}:${keyword}`, scope: scopeId === "global" ? "global" : scopeId === "u1" ? "user" : "team", scopeId, keyword, url };
    },
    learned: () => null,
  };
}

const src = source({
  u1: { convex: "https://convex.dev", gh: "https://github.com/{*}", pr: "https://github.com/x/y/pull/{1}" },
  t1: { docs: "https://docs.example" },
  global: { docs: "https://search.example/?q={*}" },
});
const go = (q: string) => resolveWith(src, q, false);

test("a plain shortcut still redirects on its own", async () => {
  assert.deepEqual(await go("convex"), { kind: "redirect", url: "https://convex.dev", via: "shortcut", linkId: "u1:convex", keyword: "convex", scope: "user" });
});

test("extra words after a plain shortcut search the web instead", async () => {
  assert.deepEqual(await go("convex components"), { kind: "search", url: "https://www.google.com/search?q=convex%20components" });
  assert.deepEqual(await go("go/convex components"), { kind: "search", url: "https://www.google.com/search?q=convex%20components" });
});

test("templated shortcuts still take their words", async () => {
  const gh = await go("gh get-convex/convex");
  assert.ok(gh.kind === "redirect" && gh.url === "https://github.com/get-convex/convex");
  const pr = await go("pr 3297");
  assert.ok(pr.kind === "redirect" && pr.url === "https://github.com/x/y/pull/3297");
});

test("more words than numbered slots fall through to search", async () => {
  assert.equal((await go("pr 3297 review comments")).kind, "search");
});

test("a shortcut further out that takes args wins over a closer plain one", async () => {
  const r = await go("docs auth tokens");
  assert.ok(r.kind === "redirect" && r.url === "https://search.example/?q=auth%20tokens");
  const plain = await go("docs");
  assert.ok(plain.kind === "redirect" && plain.url === "https://docs.example");
});
