import { edgeChanged } from "./edge";
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireMember, requireUser } from "./lib/auth";
import { randomString } from "./lib/random";
import { sha256Hex } from "./lib/sha256";

const joinHash = (code: string) => sha256Hex("join:" + code.trim());

function cleanSlug(raw: string) {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) throw new Error("Give the team a name");
  return slug;
}

/** Create a team; returns its join code (shown once, can be rotated). */
export const create = action({
  args: { token: v.string(), name: v.string(), vars: v.optional(v.record(v.string(), v.string())) },
  handler: async (ctx, args): Promise<{ teamId: Id<"teams">; joinCode: string }> => {
    const joinCode = `${cleanSlug(args.name)}-${randomString(10)}`;
    const teamId = await ctx.runMutation(internal.teams.insertTeam, {
      token: args.token,
      name: args.name.trim(),
      vars: args.vars ?? {},
      joinCodeHash: joinHash(joinCode),
    });
    return { teamId, joinCode };
  },
});

export const insertTeam = internalMutation({
  args: { token: v.string(), name: v.string(), vars: v.record(v.string(), v.string()), joinCodeHash: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const slug = cleanSlug(args.name);
    if (await ctx.db.query("teams").withIndex("by_slug", (q) => q.eq("slug", slug)).unique())
      throw new Error(`A team called "${slug}" already exists`);
    const teamId = await ctx.db.insert("teams", { slug, name: args.name, vars: args.vars, joinCodeHash: args.joinCodeHash });
    await ctx.db.insert("members", { teamId, userId: user._id, role: "admin" });
    if (!user.primaryTeamId) await ctx.db.patch(user._id, { primaryTeamId: teamId });
    await edgeChanged(ctx, ["teams", teamId], ["users", user._id]);
    return teamId;
  },
});

export const rotateJoinCode = action({
  args: { token: v.string(), teamId: v.id("teams") },
  handler: async (ctx, args): Promise<string> => {
    const code = `team-${randomString(12)}`;
    await ctx.runMutation(internal.teams.setJoinHash, { ...args, joinCodeHash: joinHash(code) });
    return code;
  },
});

export const setJoinHash = internalMutation({
  args: { token: v.string(), teamId: v.id("teams"), joinCodeHash: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const m = await requireMember(ctx, user, args.teamId);
    if (m.role !== "admin") throw new Error("Only team admins can do that");
    await ctx.db.patch(args.teamId, { joinCodeHash: args.joinCodeHash });
  },
});

export const join = mutation({
  args: { token: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const team = await ctx.db.query("teams").withIndex("by_join", (q) => q.eq("joinCodeHash", joinHash(args.code))).unique();
    if (!team) throw new Error("That join code doesn't work");
    const existing = await ctx.db
      .query("members")
      .withIndex("by_team_user", (q) => q.eq("teamId", team._id).eq("userId", user._id))
      .unique();
    if (!existing) await ctx.db.insert("members", { teamId: team._id, userId: user._id, role: "member" });
    if (!user.primaryTeamId) await ctx.db.patch(user._id, { primaryTeamId: team._id });
    await edgeChanged(ctx, ["users", user._id]);
    return team.name;
  },
});

export const leave = mutation({
  args: { token: v.string(), teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const m = await requireMember(ctx, user, args.teamId);
    await ctx.db.delete(m._id);
    if (user.primaryTeamId === args.teamId) await ctx.db.patch(user._id, { primaryTeamId: undefined });
    await edgeChanged(ctx, ["users", user._id]);
  },
});

export const setVars = mutation({
  args: { token: v.string(), teamId: v.id("teams"), vars: v.record(v.string(), v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireMember(ctx, user, args.teamId);
    const vars: Record<string, string> = {};
    for (const [k, val] of Object.entries(args.vars)) {
      const key = k.trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) throw new Error(`Bad variable name "${k}"`);
      if (val.trim()) vars[key] = val.trim();
    }
    await ctx.db.patch(args.teamId, { vars });
    await edgeChanged(ctx, ["teams", args.teamId]);
  },
});

export const members = query({
  args: { token: v.string(), teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await requireMember(ctx, user, args.teamId);
    const rows = await ctx.db.query("members").withIndex("by_team", (q) => q.eq("teamId", args.teamId)).collect();
    const out = [];
    for (const r of rows) {
      const u = await ctx.db.get(r.userId);
      if (u) out.push({ name: u.name, github: u.vars.github ?? null, role: r.role });
    }
    return out;
  },
});
