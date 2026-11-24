import { test } from "node:test";
import assert from "node:assert/strict";
import { didYouMean, editDistance } from "../convex/lib/fuzzy.ts";
import { missKeyword, reportFor, _resetSeen } from "../convex/lib/activity.ts";
import { keywordFrom, parseImport } from "../web/src/importParse.ts";

test("edit distance counts a swap as one", () => {
  assert.equal(editDistance("reviews", "reviews"), 0);
  assert.equal(editDistance("revews", "reviews"), 1);
  assert.equal(editDistance("reivews", "reviews"), 1);
  assert.equal(editDistance("abc", "xyz123", 1), 2); // gives up past max
});

test("did you mean: typos close to a keyword, not short words", () => {
  const kws = ["reviews", "my prs", "my issues", "gh", "npm", "cal", "mail", "maps"];
  assert.deepEqual(didYouMean("revews", kws), ["reviews"]);
  assert.deepEqual(didYouMean("my pr", kws), ["my prs"]);
  assert.deepEqual(didYouMean("go/reveiws", kws), ["reviews"]);
  assert.deepEqual(didYouMean("ma", kws), []); // too short to guess
  assert.deepEqual(didYouMean("reviews", kws), []); // exact isn't a suggestion
  assert.deepEqual(didYouMean("kubernetes", kws), []);
});

test("misses: short queries that found nothing", () => {
  assert.equal(missKeyword("standup", "search"), "standup");
  assert.equal(missKeyword("go/OnCall", "create"), "oncall");
  assert.equal(missKeyword("team wiki", "search"), "team wiki");
  assert.equal(missKeyword("best ramen near soma", "search"), null);
  assert.equal(missKeyword("? where is the wiki", "search"), null);
  assert.equal(missKeyword("my prs", "redirect"), null);
  assert.equal(missKeyword("what?", "search"), null);
});

test("reports: misses always, hits sampled, one check-in a day", () => {
  _resetSeen();
  const day1 = Date.UTC(2026, 10, 24, 12);
  assert.deepEqual(reportFor("h", "my prs", "redirect", true, day1, 0.9), { kind: "redirect", miss: null, hits: 0 }); // first today
  assert.equal(reportFor("h", "my prs", "redirect", true, day1 + 1000, 0.9), null);
  assert.deepEqual(reportFor("h", "my prs", "redirect", true, day1 + 2000, 0.05), { kind: "redirect", miss: null, hits: 10 });
  assert.deepEqual(reportFor("h", "standup", "search", false, day1 + 3000, 0.9), { kind: "search", miss: "standup", hits: 0 });
  assert.equal(reportFor("h", "best ramen near soma", "search", false, day1 + 4000, 0.9), null);
  assert.ok(reportFor("h", "my prs", "redirect", true, day1 + 86_400_000, 0.9)); // next day checks in again
  assert.equal(reportFor(null, "standup", "search", false, day1, 0), null); // no token, nothing to attach it to
});

test("import: bookmarks html, with Firefox keywords and made-up ones", () => {
  const html = `<DL><p>
    <DT><A HREF="https://linear.app/acme/team/ENG/active" ADD_DATE="1">Linear – Active issues</A>
    <DT><A HREF="https://www.figma.com/files/recent" SHORTCUTURL="FIG">Recent &amp; shared</A>
    <DT><A HREF="https://example.com/a?x=1&amp;y=2">The Example</A>
    <DT><A HREF="https://example.com/b">Example docs</A>
    <DT><A HREF="javascript:alert(1)">bookmarklet</A>
  </DL>`;
  const rows = parseImport(html);
  assert.deepEqual(rows.map((r) => r.keyword), ["linear", "fig", "example", "example-2"]);
  assert.equal(rows[1].description, "Recent & shared");
  assert.equal(rows[2].url, "https://example.com/a?x=1&y=2");
});

test("import: csv with and without a header", () => {
  assert.deepEqual(parseImport("go/Wiki,https://wiki.acme.dev,Team wiki\nci,https://ci.acme.dev"), [
    { keyword: "wiki", url: "https://wiki.acme.dev", description: "Team wiki" },
    { keyword: "ci", url: "https://ci.acme.dev", description: "" },
  ]);
  assert.deepEqual(parseImport('url,name,description\nhttps://x.dev,"x, the site","has ""quotes"""'), [
    { keyword: "x, the site", url: "https://x.dev", description: 'has "quotes"' },
  ]);
  assert.equal(keywordFrom("", "https://www.notion.so/acme"), "notion");
  assert.equal(keywordFrom("PR reviews", "https://x"), "pr-reviews");
});
