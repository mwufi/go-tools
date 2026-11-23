// Push sync for the edges (Cloudflare Worker, Cloud Run).
//
// Every mutation that changes something a search can see calls edgeChanged().
// That appends to a numbered change log and schedules push(), which pokes each
// edge in EDGE_SYNC_URLS. The edge then pulls /api/edge/changes?after=<its seq>.
// Edges never poll on a timer, so an idle setup costs nothing.
import { v } from "convex/values";
import { internalAction, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { teamIdsFor } from "./lib/auth";
import type { Change, ChangesPage, Dump, EdgeLearned, EdgeTable, EdgeTeam, EdgeToken, EdgeUser } from "./lib/edgeRows";
import type { LinkLite } from "./lib/core";

const PAGE = 500;

export const linkRow = (l: Doc<"links">): LinkLite => ({
  id: l._id, scope: l.scope, scopeId: l.scopeId, keyword: l.keyword, url: l.url, emptyUrl: l.emptyUrl,
});
const tokenRow = (t: Doc<"tokens">): EdgeToken => ({ id: t._id, hash: t.tokenHash, userId: t.userId });
const teamRow = (t: Doc<"teams">): EdgeTeam => ({ id: t._id, vars: t.vars });
const learnedRow = (r: Doc<"learned">): EdgeLearned => ({ id: r._id, userId: r.userId, queryNorm: r.queryNorm, url: r.url, at: r._creationTime });
async function userRow(ctx: QueryCtx, u: Doc<"users">): Promise<EdgeUser> {
  return {
    id: u._id, vars: u.vars, fallbackSearch: u.fallbackSearch, llmEnabled: u.llmEnabled, llmMy: u.llmMy,
    primaryTeamId: u.primaryTeamId, teamIds: (await teamIdsFor(ctx, u)).map(String),
  };
}

async function currentRow(ctx: QueryCtx, table: EdgeTable, id: string) {
  switch (table) {
    case "links": { const d = await ctx.db.get(id as Id<"links">); return d && linkRow(d); }
    case "users": { const d = await ctx.db.get(id as Id<"users">); return d && (await userRow(ctx, d)); }
    case "tokens": { const d = await ctx.db.get(id as Id<"tokens">); return d && tokenRow(d); }
    case "teams": { const d = await ctx.db.get(id as Id<"teams">); return d && teamRow(d); }
    case "learned": { const d = await ctx.db.get(id as Id<"learned">); return d?.kept ? learnedRow(d) : null; }
  }
}

async function currentSeq(ctx: QueryCtx): Promise<number> {
  return (await ctx.db.query("edgeLog").withIndex("by_seq").order("desc").first())?.seq ?? 0;
}

/** Record that these rows changed (call after writing them). */
export async function edgeChanged(ctx: MutationCtx, ...items: [EdgeTable, string][]) {
  let seq = await currentSeq(ctx);
  for (const [table, id] of items) {
    await ctx.db.insert("edgeLog", { seq: ++seq, table, id, row: await currentRow(ctx, table, id) });
  }
  if (process.env.EDGE_SYNC_URLS) await ctx.scheduler.runAfter(0, internal.edge.push, {});
}

export const changes = internalQuery({
  args: { after: v.number() },
  handler: async (ctx, { after }): Promise<ChangesPage> => {
    const seq = await currentSeq(ctx);
    const llm = !!process.env.LLM_API_KEY;
    // A fresh edge, or one ahead of us (the log was wiped): start over from a dump.
    if (after === 0 || after > seq) return { seq, llm, reset: true, more: false, changes: [] };
    const rows = await ctx.db.query("edgeLog").withIndex("by_seq", (q) => q.gt("seq", after)).take(PAGE + 1);
    return {
      seq, llm, reset: false, more: rows.length > PAGE,
      changes: rows.slice(0, PAGE).map((r) => ({ seq: r.seq, table: r.table, id: r.id, row: r.row }) as Change),
    };
  },
});

export const dump = internalQuery({
  args: {},
  handler: async (ctx): Promise<Dump> => {
    const users: EdgeUser[] = [];
    for (const u of await ctx.db.query("users").collect()) users.push(await userRow(ctx, u));
    return {
      seq: await currentSeq(ctx),
      llm: !!process.env.LLM_API_KEY,
      links: (await ctx.db.query("links").collect()).map(linkRow),
      users,
      tokens: (await ctx.db.query("tokens").collect()).map(tokenRow),
      teams: (await ctx.db.query("teams").collect()).map(teamRow),
      learned: (await ctx.db.query("learned").collect()).filter((r) => r.kept).map(learnedRow),
    };
  },
});

/** Poke every edge. Each one pulls what it's missing; a missed poke is caught on its next check. */
export const push = internalAction({
  args: {},
  handler: async () => {
    const urls = (process.env.EDGE_SYNC_URLS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    await Promise.all(
      urls.map((u) =>
        fetch(`${u.replace(/\/$/, "")}/_sync`, {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.EDGE_SYNC_SECRET ?? ""}` },
          signal: AbortSignal.timeout(5_000),
        }).catch((e) => console.warn(`edge ${u}: ${e}`)),
      ),
    );
  },
});
