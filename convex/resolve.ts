import { v } from "convex/values";
import { internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { userByHash, teamIdsFor, hashToken } from "./lib/auth";
import { resolveWith, type LinkLite, type Source, type UserLite } from "./lib/core";

export type { Resolution } from "./lib/core";

async function sourceFor(ctx: QueryCtx, tokenHash: string | undefined): Promise<Source> {
  const user = await userByHash(ctx, tokenHash);
  const teamIds = user ? await teamIdsFor(ctx, user) : [];
  return {
    user: user ? toUserLite(user) : null,
    scopes: [...(user ? [user._id as string] : []), ...teamIds.map(String), "global"],
    teamVars: async (id) => (await ctx.db.get(id as Id<"teams">))?.vars ?? {},
    link: async (scopeId, keyword) => {
      const l = await ctx.db
        .query("links")
        .withIndex("by_scope_keyword", (x) => x.eq("scopeId", scopeId).eq("keyword", keyword))
        .unique();
      return l ? toLinkLite(l) : null;
    },
    learned: async (queryNorm) => {
      if (!user) return null;
      const row = await ctx.db
        .query("learned")
        .withIndex("by_user_query", (x) => x.eq("userId", user._id).eq("queryNorm", queryNorm))
        .order("desc")
        .first();
      return row?.kept ? row.url : null;
    },
  };
}

const toUserLite = (u: Doc<"users">): UserLite => ({
  id: u._id, vars: u.vars, fallbackSearch: u.fallbackSearch, llmEnabled: u.llmEnabled, llmMy: u.llmMy, primaryTeamId: u.primaryTeamId,
});
const toLinkLite = (l: Doc<"links">): LinkLite => ({
  id: l._id, scope: l.scope, scopeId: l.scopeId, keyword: l.keyword, url: l.url, emptyUrl: l.emptyUrl,
});

/**
 * The hot path. One query: token lookup, a handful of index point reads,
 * template fill. No writes. Pure function of its args + the rows it reads,
 * so Convex can serve repeats from its query cache.
 */
async function resolveImpl(ctx: QueryCtx, tokenHash: string | undefined, q: string, llmAvailable: boolean) {
  return await resolveWith(await sourceFor(ctx, tokenHash), q, llmAvailable);
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
