import { internalMutation } from "./_generated/server";
import { upsertLink } from "./links";

// Built-in shortcuts everyone gets. Personal or team shortcuts with the same
// keyword take priority. Re-run `npx convex run seed:run` after editing.
export const GLOBAL: { keyword: string; url: string; emptyUrl?: string; description: string }[] = [
  { keyword: "my prs", url: "https://github.com/pulls?q=is%3Aopen+is%3Apr+author%3A{me.github}", description: "Your open GitHub pull requests" },
  { keyword: "reviews", url: "https://github.com/pulls?q=is%3Aopen+is%3Apr+review-requested%3A{me.github}", description: "PRs waiting on your review" },
  { keyword: "my issues", url: "https://github.com/issues?q=is%3Aopen+assignee%3A{me.github}", description: "GitHub issues assigned to you" },
  { keyword: "gh", url: "https://github.com/{*}", emptyUrl: "https://github.com", description: "GitHub: gh owner/repo" },
  { keyword: "ghs", url: "https://github.com/search?q={*}&type=code", description: "Search code on GitHub" },
  { keyword: "g", url: "https://www.google.com/search?q={*}", emptyUrl: "https://www.google.com", description: "Google search" },
  { keyword: "yt", url: "https://www.youtube.com/results?search_query={*}", emptyUrl: "https://www.youtube.com", description: "YouTube search" },
  { keyword: "w", url: "https://en.wikipedia.org/wiki/Special:Search?search={*}", description: "Wikipedia" },
  { keyword: "maps", url: "https://www.google.com/maps/search/{*}", emptyUrl: "https://www.google.com/maps", description: "Google Maps" },
  { keyword: "cal", url: "https://calendar.google.com/calendar/r", description: "Google Calendar" },
  { keyword: "mail", url: "https://mail.google.com/mail/u/0/#search/{*}", emptyUrl: "https://mail.google.com", description: "Gmail, or search it" },
  { keyword: "drive", url: "https://drive.google.com/drive/search?q={*}", emptyUrl: "https://drive.google.com", description: "Google Drive, or search it" },
  { keyword: "npm", url: "https://www.npmjs.com/package/{1}", emptyUrl: "https://www.npmjs.com", description: "npm package page" },
  { keyword: "mdn", url: "https://developer.mozilla.org/en-US/search?q={*}", description: "MDN web docs" },
  { keyword: "convex", url: "https://dashboard.convex.dev", description: "Convex dashboard" },
  { keyword: "cdocs", url: "https://docs.convex.dev/search?q={*}", emptyUrl: "https://docs.convex.dev", description: "Convex docs" },
  { keyword: "x", url: "https://x.com/search?q={*}", emptyUrl: "https://x.com", description: "Search X" },
  { keyword: "hn", url: "https://hn.algolia.com/?q={*}", emptyUrl: "https://news.ycombinator.com", description: "Hacker News" },
  { keyword: "claude", url: "https://claude.ai/new?q={*}", emptyUrl: "https://claude.ai", description: "Ask Claude" },
  { keyword: "chatgpt", url: "https://chatgpt.com/?q={*}", emptyUrl: "https://chatgpt.com", description: "Ask ChatGPT" },
  { keyword: "pplx", url: "https://www.perplexity.ai/search?q={*}", description: "Perplexity" },
];

export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;
    for (const l of GLOBAL) {
      const r = await upsertLink(ctx, null, { scope: "global", scopeId: "global" }, l);
      if (r.created) created++;
    }
    return { total: GLOBAL.length, created };
  },
});
