// What people search for, kept just enough to help them: did setup work,
// which searches keep missing (so we can suggest a shortcut), and a weekly count.
import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember, requireUser, teamIdsFor, userByHash } from "./lib/auth";
import { dayOf } from "./lib/activity";
import { didYouMean } from "./lib/fuzzy";

const DAY = 86_400_000;
export const MISS_TTL = 30 * DAY;

/** Called (off the redirect's critical path where possible) by /s and the edges. */
export const record = internalMutation({
  args: {
    tokenHash: v.string(),
    kind: v.string(),
    miss: v.union(v.string(), v.null()),
    hits: v.number(),
    linkId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const user = await userByHash(ctx, a.tokenHash);
    if (!user) return;
    await recordFor(ctx, user, a);
  },
});

export async function recordFor(ctx: MutationCtx, user: Doc<"users">, a: { miss: string | null; hits: number; linkId?: string }) {
  const now = Date.now();
  if (!user.firstSearchAt) await ctx.db.patch(user._id, { firstSearchAt: now });

  const hits = Math.min(Math.max(a.hits, 0), 10);
  const web = a.miss ? 1 : 0;
  if (hits || web) {
    const day = dayOf(now);
    const row = await ctx.db.query("usage").withIndex("by_user_day", (q) => q.eq("userId", user._id).eq("day", day)).unique();
    if (row) await ctx.db.patch(row._id, { shortcuts: row.shortcuts + hits, web: row.web + web });
    else await ctx.db.insert("usage", { userId: user._id, day, shortcuts: hits, web });
  }
  if (hits && a.linkId) {
    const id = ctx.db.normalizeId("links", a.linkId);
    const l = id && (await ctx.db.get(id));
    if (l) await ctx.db.patch(l._id, { clicks: l.clicks + hits });
  }
  if (a.miss && user.trackMisses !== false) {
    const row = await ctx.db.query("misses").withIndex("by_user_query", (q) => q.eq("userId", user._id).eq("query", a.miss!)).unique();
    if (row) await ctx.db.patch(row._id, { count: row.lastAt < now - MISS_TTL ? 1 : row.count + 1, lastAt: now });
    else await ctx.db.insert("misses", { userId: user._id, query: a.miss, count: 1, lastAt: now, dismissed: false });
  }
}

async function scopesOf(ctx: QueryCtx, user: Doc<"users">) {
  const teamIds = await teamIdsFor(ctx, user);
  return { teamIds, scopes: [user._id as string, ...teamIds.map(String), "global"] };
}

async function keywordExists(ctx: QueryCtx, scopes: string[], keyword: string) {
  for (const s of scopes) {
    const l = await ctx.db.query("links").withIndex("by_scope_keyword", (q) => q.eq("scopeId", s).eq("keyword", keyword)).first();
    if (l) return true;
  }
  return false;
}

async function allKeywords(ctx: QueryCtx, scopes: string[]) {
  const out = new Set<string>();
  for (const s of scopes) for (const l of await ctx.db.query("links").withIndex("by_scope_keyword", (q) => q.eq("scopeId", s)).collect()) out.add(l.keyword);
  return out;
}

/** Home page: did setup work, this week's numbers, and searches worth turning into shortcuts. */
export const mine = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx, token);
    const { teamIds, scopes } = await scopesOf(ctx, user);
    const now = Date.now();

    // This week, and how many days in a row (ending today or yesterday) you used it.
    const days = await ctx.db
      .query("usage")
      .withIndex("by_user_day", (q) => q.eq("userId", user._id).gte("day", dayOf(now - 60 * DAY)))
      .collect();
    const weekStart = dayOf(now - 6 * DAY);
    const week = { shortcuts: 0, web: 0, days: 0 };
    for (const d of days) if (d.day >= weekStart) { week.shortcuts += d.shortcuts; week.web += d.web; week.days++; }
    const active = new Set(days.map((d) => d.day));
    let streak = 0;
    for (let t = active.has(dayOf(now)) ? now : now - DAY; active.has(dayOf(t)); t -= DAY) streak++;

    // Your repeated misses that still don't have a shortcut.
    const recent = await ctx.db
      .query("misses")
      .withIndex("by_user_last", (q) => q.eq("userId", user._id).gte("lastAt", now - MISS_TTL))
      .order("desc")
      .take(200);
    const keywords = await allKeywords(ctx, scopes);
    const suggestions = [];
    for (const m of recent.filter((m) => m.count >= 2 && !m.dismissed).sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)) {
      if (keywords.has(m.query)) continue;
      suggestions.push({ _id: m._id, query: m.query, count: m.count, near: didYouMean(m.query, keywords, 1)[0] ?? null });
      if (suggestions.length >= 4) break;
    }

    // Keywords several teammates tried that no shortcut answers yet.
    const wanted = [];
    for (const teamId of teamIds) {
      for (const w of await wantedFor(ctx, teamId, keywords)) wanted.push({ ...w, teamId });
    }
    wanted.sort((a, b) => b.people - a.people);
    const mineSet = new Set(suggestions.map((s) => s.query));

    return {
      firstSearchAt: user.firstSearchAt ?? null,
      trackMisses: user.trackMisses !== false,
      week,
      streak,
      suggestions,
      wanted: wanted.filter((w) => !mineSet.has(w.query)).slice(0, 4),
    };
  },
});

/** Misses tried by at least two people on the team in the last 30 days. Counts only, never names. */
async function wantedFor(ctx: QueryCtx, teamId: Id<"teams">, existing: Set<string>) {
  const members = await ctx.db.query("members").withIndex("by_team", (q) => q.eq("teamId", teamId)).collect();
  if (members.length < 2) return [];
  const since = Date.now() - MISS_TTL;
  const people = new Map<string, number>();
  for (const m of members.slice(0, 200)) {
    const rows = await ctx.db
      .query("misses")
      .withIndex("by_user_last", (q) => q.eq("userId", m.userId).gte("lastAt", since))
      .take(200);
    for (const r of rows) people.set(r.query, (people.get(r.query) ?? 0) + 1);
  }
  return [...people]
    .filter(([q, n]) => n >= 2 && !existing.has(q))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([query, n]) => ({ query, people: n }));
}

/** For the team page: what the team keeps reaching for. */
export const teamWanted = query({
  args: { token: v.string(), teamId: v.id("teams") },
  handler: async (ctx, { token, teamId }) => {
    const user = await requireUser(ctx, token);
    await requireMember(ctx, user, teamId);
    const keywords = await allKeywords(ctx, [teamId as string, "global"]);
    return await wantedFor(ctx, teamId, keywords);
  },
});

export const dismiss = mutation({
  args: { token: v.string(), missId: v.id("misses") },
  handler: async (ctx, { token, missId }) => {
    const user = await requireUser(ctx, token);
    const m = await ctx.db.get(missId);
    if (m && m.userId === user._id) await ctx.db.patch(missId, { dismissed: true });
  },
});

/** Turn miss tracking on or off. Turning it off also forgets what was kept. */
export const setTracking = mutation({
  args: { token: v.string(), on: v.boolean() },
  handler: async (ctx, { token, on }) => {
    const user = await requireUser(ctx, token);
    await ctx.db.patch(user._id, { trackMisses: on });
    if (!on) for (const m of await ctx.db.query("misses").withIndex("by_user_last", (q) => q.eq("userId", user._id)).collect()) await ctx.db.delete(m._id);
  },
});

/** "Did you mean" for the web app: keywords a typo away from what was typed. */
export const nearby = query({
  args: { token: v.string(), q: v.string() },
  handler: async (ctx, { token, q }) => {
    const user = await requireUser(ctx, token);
    const { scopes } = await scopesOf(ctx, user);
    const keywords = await allKeywords(ctx, scopes);
    const words = q.trim().toLowerCase().replace(/^go\//, "").split(/\s+/);
    // Try the whole query, then its first two words and first word (the keyword part).
    const out = new Set<string>();
    for (const n of [words.length, 2, 1]) if (n <= words.length) for (const k of didYouMean(words.slice(0, n).join(" "), keywords)) out.add(k);
    return [...out].slice(0, 3);
  },
});

/** Daily: forget misses older than 30 days, and expired sign-in codes. */
export const purge = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db.query("misses").withIndex("by_last", (q) => q.lt("lastAt", Date.now() - MISS_TTL)).take(2000);
    for (const m of old) await ctx.db.delete(m._id);
    for (const c of await ctx.db.query("loginCodes").collect()) if (c.expiresAt < Date.now()) await ctx.db.delete(c._id);
  },
});
