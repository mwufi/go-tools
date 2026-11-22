import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { userByHash, teamIdsFor, hashToken } from "./lib/auth";
import {
  candidates,
  fillTemplate,
  normalizeQuery,
  parseQuery,
  searchUrl,
} from "./lib/go";

export type Resolution =
  | { kind: "redirect"; url: string; via: "shortcut" | "learned"; linkId?: Id<"links">; keyword?: string; scope?: string }
  | { kind: "think"; q: string }
  | { kind: "search"; url: string }
  | { kind: "create"; keyword: string }
  | { kind: "info"; keyword: string }
  | { kind: "home" };

/**
 * The hot path. One query: token lookup, a handful of index point reads,
 * template fill. No writes. Pure function of its args + the rows it reads,
 * so Convex can serve repeats from its query cache.
 */
async function resolveImpl(
  ctx: QueryCtx,
  tokenHash: string | undefined,
  q: string,
  llmAvailable: boolean,
): Promise<Resolution> {
  const parsed = parseQuery(q);
  if (parsed.kind === "home") return { kind: "home" };
  if (parsed.kind === "info") return { kind: "info", keyword: parsed.keyword };

  const user = await userByHash(ctx, tokenHash);
  const teamIds = user ? await teamIdsFor(ctx, user) : [];
  const scopes: string[] = [...(user ? [user._id as string] : []), ...teamIds.map(String), "global"];
  const teams = new Map<string, Doc<"teams">>();
  const teamVars = async (teamId?: string) => {
    if (!teamId) return {};
    if (!teams.has(teamId)) {
      const t = await ctx.db.get(teamId as Id<"teams">);
      if (t) teams.set(teamId, t);
    }
    return teams.get(teamId)?.vars ?? {};
  };

  if (!parsed.askLlm) {
    for (const c of candidates(parsed.lower)) {
      for (const scopeId of scopes) {
        const link = await ctx.db
          .query("links")
          .withIndex("by_scope_keyword", (x) => x.eq("scopeId", scopeId).eq("keyword", c.keyword))
          .unique();
        if (!link) continue;
        const args = parsed.words.slice(c.n);
        const vars = {
          me: user?.vars ?? {},
          team: await teamVars(link.scope === "team" ? link.scopeId : (user?.primaryTeamId ?? teamIds[0])),
        };
        let url = fillTemplate(link.url, args, vars);
        if (url === null && args.length === 0 && link.emptyUrl) url = fillTemplate(link.emptyUrl, [], vars);
        if (url === null) return { kind: "info", keyword: link.keyword };
        return { kind: "redirect", url, via: "shortcut", linkId: link._id, keyword: link.keyword, scope: link.scope };
      }
    }
  }

  if (user) {
    const learned = await ctx.db
      .query("learned")
      .withIndex("by_user_query", (x) => x.eq("userId", user._id).eq("queryNorm", normalizeQuery(parsed.raw)))
      .order("desc")
      .first();
    if (learned?.kept) return { kind: "redirect", url: learned.url, via: "learned" };
  }

  const wantsLlm =
    parsed.askLlm || (user?.llmMy === true && parsed.lower[0] === "my" && parsed.words.length > 1);
  if (wantsLlm && llmAvailable && user?.llmEnabled) return { kind: "think", q: parsed.raw };

  if (parsed.explicit && parsed.words.length === 1) return { kind: "create", keyword: parsed.lower[0] };

  return { kind: "search", url: searchUrl(user?.fallbackSearch ?? "google", parsed.raw) };
}

export const resolve = internalQuery({
  args: { tokenHash: v.optional(v.string()), q: v.string(), llmAvailable: v.boolean() },
  handler: (ctx, args) => resolveImpl(ctx, args.tokenHash, args.q, args.llmAvailable),
});

/** Live preview for the web app's command bar. */
export const preview = query({
  args: { token: v.optional(v.string()), q: v.string(), llmAvailable: v.boolean() },
  handler: (ctx, args) =>
    resolveImpl(ctx, args.token ? hashToken(args.token) : undefined, args.q, args.llmAvailable),
});

/** Address-bar suggestions: keywords that start with what you've typed. */
export const suggest = internalQuery({
  args: { tokenHash: v.optional(v.string()), q: v.string() },
  handler: async (ctx, args) => {
    const prefix = args.q.trim().toLowerCase().replace(/^go\//, "").replace(/\s+/g, " ");
    if (!prefix) return [];
    const user = await userByHash(ctx, args.tokenHash);
    const teamIds = user ? await teamIdsFor(ctx, user) : [];
    const scopes = [...(user ? [user._id as string] : []), ...teamIds.map(String), "global"];
    const seen = new Map<string, { keyword: string; description: string }>();
    for (const s of scopes) {
      const rows = await ctx.db
        .query("links")
        .withIndex("by_scope_keyword", (x) => x.eq("scopeId", s).gte("keyword", prefix).lt("keyword", prefix + "￿"))
        .take(6);
      for (const r of rows) if (!seen.has(r.keyword)) seen.set(r.keyword, { keyword: r.keyword, description: r.description });
    }
    return [...seen.values()].slice(0, 8);
  },
});
