import { test } from "node:test";
import assert from "node:assert/strict";
import { argsFit, candidates, fillTemplate, maxArgs, parseQuery, searchUrl, validateKeyword } from "../convex/lib/go.ts";
import { sha256Hex } from "../convex/lib/sha256.ts";

const vars = { me: { github: "mwufi" }, team: { github_org: "a16z-NewMedia" } };

test("parse: prefixes, sigils, info", () => {
  assert.deepEqual(parseQuery("go"), { kind: "home" });
  assert.deepEqual(parseQuery("npm+"), { kind: "info", keyword: "npm" });
  const p = parseQuery("go/Foo bar");
  assert.equal(p.kind, "query");
  if (p.kind === "query") { assert.equal(p.explicit, true); assert.deepEqual(p.words, ["Foo", "bar"]); assert.deepEqual(p.lower, ["foo", "bar"]); }
  const a = parseQuery("? prs waiting on me");
  assert.ok(a.kind === "query" && a.askLlm && a.raw === "prs waiting on me");
  const b = parseQuery("weather tomorrow!");
  assert.ok(b.kind === "query" && b.askLlm && b.raw === "weather tomorrow");
  const c = parseQuery("good morning");
  assert.ok(c.kind === "query" && !c.askLlm && !c.explicit);
});

test("candidates are longest first, at most 3 words", () => {
  assert.deepEqual(candidates(["my", "prs", "cosign", "x"]).map((c) => c.keyword), ["my prs cosign", "my prs", "my"]);
});

test("templates", () => {
  assert.equal(fillTemplate("https://github.com/{*}", ["get-convex/convex"], vars), "https://github.com/get-convex/convex");
  assert.equal(fillTemplate("https://g.co/search?q={*}", ["a/b c"], vars), "https://g.co/search?q=a%2Fb%20c");
  assert.equal(fillTemplate("https://x/{1}/{2}", ["a", "b"], vars), "https://x/a/b");
  assert.equal(fillTemplate("https://github.com/{team.github_org}/cosign/pull/{1}", ["3297"], vars), "https://github.com/a16z-NewMedia/cosign/pull/3297");
  assert.equal(fillTemplate("https://github.com/pulls?q=author:{me.github}", [], vars), "https://github.com/pulls?q=author:mwufi");
  assert.equal(fillTemplate("https://x?q=%s", ["hi"], vars), "https://x?q=hi");
  assert.equal(fillTemplate("https://x/{1}", [], vars), null, "missing arg");
  assert.equal(fillTemplate("https://x/{me.linear}", [], vars), null, "missing var");
});

test("extra words only fit templates with a slot for them", () => {
  assert.equal(maxArgs("https://convex.dev"), 0);
  assert.equal(maxArgs("https://github.com/{me.github}"), 0);
  assert.equal(maxArgs("https://x/{1}/{2}"), 2);
  assert.equal(maxArgs("https://github.com/{*}"), Infinity);
  assert.equal(maxArgs("https://x?q=%s"), Infinity);
  assert.equal(argsFit("https://convex.dev", []), true);
  assert.equal(argsFit("https://convex.dev", ["components"]), false);
  assert.equal(argsFit("https://x/{1}", ["3297"]), true);
  assert.equal(argsFit("https://x/{1}", ["3297", "extra"]), false);
  assert.equal(argsFit("https://github.com/{*}", ["a", "b", "c"]), true);
});

test("keyword validation", () => {
  assert.equal(validateKeyword(" My  PRs "), "my prs");
  assert.throws(() => validateKeyword("a b c d"));
  assert.throws(() => validateKeyword("settings"));
  assert.throws(() => validateKeyword("bad/char"));
});

test("search fall-through", () => {
  assert.equal(searchUrl("kagi", "a b"), "https://kagi.com/search?q=a%20b");
  assert.equal(searchUrl("https://s.example/?q={*}", "x"), "https://s.example/?q=x");
  assert.equal(searchUrl("nope", "x"), "https://www.google.com/search?q=x");
});

test("sha256", () => {
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
