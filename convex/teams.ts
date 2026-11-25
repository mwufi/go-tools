import { edgeChanged } from "./edge";
import { v } from "convex/values";
import { action, internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
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

/** What an invite link points at, so a signed-in person can confirm before joining. */
export const peekInvite = query({
  args: { token: v.optional(v.string()), code: v.string() },
  handler: async (ctx, args) => {
    const team = await ctx.db.query("teams").withIndex("by_join", (q) => q.eq("joinCodeHash", joinHash(args.code))).unique();
    if (!team) return null;
    const user = args.token ? await requireUser(ctx, args.token) : null;
    const member = user && (await ctx.db.query("members").withIndex("by_team_user", (q) => q.eq("teamId", team._id).eq("userId", user._id)).unique());
    return { name: team.name, slug: team.slug, already: !!member };
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
    if (m.role === "admin") await requireAnotherAdmin(ctx, args.teamId, user._id, "leave");
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

// ------------------------------------------------------------ team page

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function requireAdmin(ctx: QueryCtx, token: string, teamId: Id<"teams">) {
  const user = await requireUser(ctx, token);
  const m = await requireMember(ctx, user, teamId);
  if (m.role !== "admin") throw new Error("Only team admins can do that");
  return user;
}

/** Throws unless someone other than userId is an admin of the team. */
async function requireAnotherAdmin(ctx: QueryCtx, teamId: Id<"teams">, userId: Id<"users">, what: string) {
  const rows = await ctx.db.query("members").withIndex("by_team", (q) => q.eq("teamId", teamId)).collect();
  if (rows.length > 1 && !rows.some((r) => r.role === "admin" && r.userId !== userId))
    throw new Error(`Make someone else an admin before you ${what}`);
}

/** Everything the team page shows: pictures, about, members with roles, shortcut counts. */
export const detail = query({
  args: { token: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const team = await ctx.db.query("teams").withIndex("by_slug", (q) => q.eq("slug", args.slug)).unique();
    if (!team) return null;
    const me = await ctx.db
      .query("members")
      .withIndex("by_team_user", (q) => q.eq("teamId", team._id).eq("userId", user._id))
      .unique();
    if (!me) return null; // not a member: same as not found
    const links = await ctx.db.query("links").withIndex("by_scope_keyword", (q) => q.eq("scopeId", team._id)).collect();
    const added = new Map<string, number>();
    for (const l of links) if (l.ownerId) added.set(l.ownerId, (added.get(l.ownerId) ?? 0) + 1);
    const rows = await ctx.db.query("members").withIndex("by_team", (q) => q.eq("teamId", team._id)).collect();
    const members = [];
    for (const r of rows) {
      const u = await ctx.db.get(r.userId);
      if (!u) continue;
      members.push({
        userId: u._id, name: u.name, github: u.vars.github ?? null, role: r.role,
        joinedAt: r._creationTime, shortcuts: added.get(u._id) ?? 0, isMe: u._id === user._id,
      });
    }
    members.sort((a, b) => (a.role === b.role ? a.joinedAt - b.joinedAt : a.role === "admin" ? -1 : 1));
    return {
      _id: team._id, name: team.name, slug: team.slug, about: team.about ?? "", vars: team.vars,
      createdAt: team._creationTime,
      avatarUrl: team.avatarId ? await ctx.storage.getUrl(team.avatarId) : null,
      headerUrl: team.headerId ? await ctx.storage.getUrl(team.headerId) : null,
      myRole: me.role, shortcutCount: links.length, members,
    };
  },
});

export const update = mutation({
  args: { token: v.string(), teamId: v.id("teams"), name: v.optional(v.string()), about: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token, args.teamId);
    const patch: Partial<Doc<"teams">> = {};
    if (args.name !== undefined) {
      if (!args.name.trim()) throw new Error("Give the team a name");
      patch.name = args.name.trim().slice(0, 60);
    }
    if (args.about !== undefined) patch.about = args.about.trim().slice(0, 280);
    await ctx.db.patch(args.teamId, patch);
  },
});

/** Step 1 of a picture upload: a one-time URL the browser POSTs the file to. */
export const imageUploadUrl = mutation({
  args: { token: v.string(), teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token, args.teamId);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Step 2: attach the uploaded file (or clear it with no storageId). */
export const setImage = mutation({
  args: {
    token: v.string(),
    teamId: v.id("teams"),
    kind: v.union(v.literal("avatar"), v.literal("header")),
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token, args.teamId);
    if (args.storageId) {
      const file = await ctx.db.system.get(args.storageId);
      const bad = !file || !file.contentType?.startsWith("image/") || file.size > MAX_IMAGE_BYTES;
      if (bad) {
        await ctx.storage.delete(args.storageId);
        throw new Error("Use an image under 5 MB (PNG, JPEG, GIF, WebP or SVG)");
      }
    }
    const team = (await ctx.db.get(args.teamId))!;
    const field = args.kind === "avatar" ? "avatarId" : "headerId";
    const old = team[field];
    if (old && old !== args.storageId) await ctx.storage.delete(old);
    await ctx.db.patch(args.teamId, { [field]: args.storageId });
  },
});

export const setRole = mutation({
  args: { token: v.string(), teamId: v.id("teams"), userId: v.id("users"), role: v.union(v.literal("admin"), v.literal("member")) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token, args.teamId);
    const m = await memberRow(ctx, args.teamId, args.userId);
    if (args.role === "member" && m.role === "admin") await requireAnotherAdmin(ctx, args.teamId, args.userId, "step down");
    await ctx.db.patch(m._id, { role: args.role });
  },
});

export const removeMember = mutation({
  args: { token: v.string(), teamId: v.id("teams"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx, args.token, args.teamId);
    if (admin._id === args.userId) throw new Error("Use Leave team to remove yourself");
    const m = await memberRow(ctx, args.teamId, args.userId);
    await ctx.db.delete(m._id);
    const u = await ctx.db.get(args.userId);
    if (u?.primaryTeamId === args.teamId) await ctx.db.patch(u._id, { primaryTeamId: undefined });
    await edgeChanged(ctx, ["users", args.userId]); // their searches stop seeing team shortcuts
  },
});

async function memberRow(ctx: MutationCtx, teamId: Id<"teams">, userId: Id<"users">) {
  const m = await ctx.db
    .query("members")
    .withIndex("by_team_user", (q) => q.eq("teamId", teamId).eq("userId", userId))
    .unique();
  if (!m) throw new Error("They aren't on this team");
  return m;
}
