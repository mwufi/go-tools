import { edgeChanged } from "./edge";
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashToken, requireUser, teamIdsFor } from "./lib/auth";
import { newToken, randomString } from "./lib/random";
import { SEARCH_ENGINES } from "./lib/go";
import { sha256Hex } from "./lib/sha256";

const varsValidator = v.record(v.string(), v.string());

function cleanVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(vars)) {
    const key = k.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,31}$/.test(key)) throw new Error(`Bad variable name "${k}"`);
    if (val.trim()) out[key] = val.trim();
  }
  return out;
}

/** Sign up with an invite code (GO_INVITE_CODE) or a team join code. Returns both tokens once. */
export const signup = action({
  args: { name: v.string(), github: v.optional(v.string()), code: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ searchToken: string; apiToken: string }> => {
    const searchToken = newToken("search");
    const apiToken = newToken("api");
    await ctx.runMutation(internal.users.createUser, {
      name: args.name,
      github: args.github,
      code: args.code,
      inviteOk: !process.env.GO_INVITE_CODE || args.code?.trim() === process.env.GO_INVITE_CODE,
      searchHash: hashToken(searchToken),
      apiHash: hashToken(apiToken),
      searchHint: searchToken.slice(-4),
      apiHint: apiToken.slice(-4),
    });
    return { searchToken, apiToken };
  },
});

export const createUser = internalMutation({
  args: {
    name: v.string(),
    github: v.optional(v.string()),
    code: v.optional(v.string()),
    inviteOk: v.boolean(),
    searchHash: v.string(),
    apiHash: v.string(),
    searchHint: v.string(),
    apiHint: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) throw new Error("Tell us your name");
    // A team join code works as an invite and also puts you on that team.
    const code = args.code?.trim() ?? "";
    const team = code
      ? await ctx.db.query("teams").withIndex("by_join", (q) => q.eq("joinCodeHash", sha256Hex("join:" + code))).unique()
      : null;
    if (!args.inviteOk && !team) throw new Error("That invite code doesn't work");
    const teamId: Id<"teams"> | undefined = team?._id;
    const vars: Record<string, string> = {};
    if (args.github?.trim()) vars.github = args.github.trim().replace(/^@/, "");
    const userId = await ctx.db.insert("users", {
      name,
      vars,
      fallbackSearch: "google",
      llmEnabled: true,
      llmMy: true,
      primaryTeamId: teamId,
    });
    if (teamId) await ctx.db.insert("members", { teamId, userId, role: "member" });
    const t1 = await ctx.db.insert("tokens", { userId, tokenHash: args.searchHash, kind: "search", label: "Browser", hint: args.searchHint });
    const t2 = await ctx.db.insert("tokens", { userId, tokenHash: args.apiHash, kind: "api", label: "Web app", hint: args.apiHint });
    await edgeChanged(ctx, ["users", userId], ["tokens", t1], ["tokens", t2]);
  },
});

export const me = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    let user;
    try {
      user = await requireUser(ctx, token);
    } catch {
      return null;
    }
    const teamIds = await teamIdsFor(ctx, user);
    const teams = [];
    for (const id of teamIds) {
      const t = await ctx.db.get(id);
      const m = await ctx.db
        .query("members")
        .withIndex("by_team_user", (q) => q.eq("teamId", id).eq("userId", user._id))
        .unique();
      if (t)
        teams.push({
          _id: t._id, slug: t.slug, name: t.name, vars: t.vars, role: m?.role ?? "member",
          avatarUrl: t.avatarId ? await ctx.storage.getUrl(t.avatarId) : null,
        });
    }
    const tokens = (
      await ctx.db.query("tokens").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()
    ).map((t) => ({ _id: t._id, kind: t.kind, label: t.label, hint: t.hint, createdAt: t._creationTime }));
    return {
      _id: user._id,
      name: user.name,
      vars: user.vars,
      fallbackSearch: user.fallbackSearch,
      llmEnabled: user.llmEnabled,
      llmMy: user.llmMy,
      primaryTeamId: user.primaryTeamId ?? null,
      teams,
      tokens,
      llmConfigured: !!process.env.LLM_API_KEY,
      engines: Object.entries(SEARCH_ENGINES).map(([key, e]) => ({ key, name: e.name })),
    };
  },
});

export const updateSettings = mutation({
  args: {
    token: v.string(),
    name: v.optional(v.string()),
    vars: v.optional(varsValidator),
    fallbackSearch: v.optional(v.string()),
    llmEnabled: v.optional(v.boolean()),
    llmMy: v.optional(v.boolean()),
    primaryTeamId: v.optional(v.id("teams")),
  },
  handler: async (ctx, { token, ...patch }) => {
    const user = await requireUser(ctx, token);
    if (patch.vars) patch.vars = cleanVars(patch.vars);
    if (patch.fallbackSearch && !SEARCH_ENGINES[patch.fallbackSearch] && !patch.fallbackSearch.includes("{*}"))
      throw new Error("Pick an engine, or give a URL with {*} where the query goes");
    if (patch.name !== undefined && !patch.name.trim()) throw new Error("Name can't be empty");
    await ctx.db.patch(user._id, patch);
    await edgeChanged(ctx, ["users", user._id]);
  },
});

/** Mint another token (e.g. one per device, or an API token for an agent). */
export const createToken = action({
  args: { token: v.string(), kind: v.union(v.literal("search"), v.literal("api")), label: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const fresh = newToken(args.kind);
    await ctx.runMutation(internal.users.storeToken, {
      token: args.token,
      kind: args.kind,
      label: args.label.trim() || (args.kind === "api" ? "Agent" : "Browser"),
      hash: hashToken(fresh),
      hint: fresh.slice(-4),
    });
    return fresh;
  },
});

export const storeToken = internalMutation({
  args: { token: v.string(), kind: v.union(v.literal("search"), v.literal("api")), label: v.string(), hash: v.string(), hint: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const id = await ctx.db.insert("tokens", { userId: user._id, tokenHash: args.hash, kind: args.kind, label: args.label, hint: args.hint });
    await edgeChanged(ctx, ["tokens", id]);
  },
});

export const revokeToken = mutation({
  args: { token: v.string(), tokenId: v.id("tokens") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const row = await ctx.db.get(args.tokenId);
    if (!row || row.userId !== user._id) throw new Error("Not your token");
    if (row.tokenHash === hashToken(args.token)) throw new Error("That's the token this page is using");
    await ctx.db.delete(args.tokenId);
    await edgeChanged(ctx, ["tokens", args.tokenId]);
  },
});

// ---------------------------------------------------------------- sign in on another device
const LOGIN_TTL = 10 * 60_000;
const loginHash = (code: string) => sha256Hex("login:" + code.trim().replace(/[\s-]/g, "").toUpperCase());

/** A one-time code (and link) that signs this person in on another device. Lasts 10 minutes. */
export const createLoginCode = action({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{ code: string; expiresAt: number }> => {
    const raw = randomString(8).toUpperCase();
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    const expiresAt = Date.now() + LOGIN_TTL;
    await ctx.runMutation(internal.users.storeLoginCode, { token: args.token, codeHash: loginHash(code), expiresAt });
    return { code, expiresAt };
  },
});

export const storeLoginCode = internalMutation({
  args: { token: v.string(), codeHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    await ctx.db.insert("loginCodes", { userId: user._id, codeHash: args.codeHash, expiresAt: args.expiresAt });
  },
});

/** Trade a sign-in code for fresh tokens on this device. The code stops working. */
export const redeemLoginCode = action({
  args: { code: v.string() },
  handler: async (ctx, args): Promise<{ searchToken: string; apiToken: string }> => {
    const searchToken = newToken("search");
    const apiToken = newToken("api");
    await ctx.runMutation(internal.users.useLoginCode, {
      codeHash: loginHash(args.code),
      searchHash: hashToken(searchToken),
      apiHash: hashToken(apiToken),
      searchHint: searchToken.slice(-4),
      apiHint: apiToken.slice(-4),
    });
    return { searchToken, apiToken };
  },
});

export const useLoginCode = internalMutation({
  args: { codeHash: v.string(), searchHash: v.string(), apiHash: v.string(), searchHint: v.string(), apiHint: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("loginCodes").withIndex("by_hash", (q) => q.eq("codeHash", args.codeHash)).unique();
    if (!row || row.expiresAt < Date.now()) throw new Error("That sign-in code doesn't work or has expired. Make a new one in Settings on your other device.");
    await ctx.db.delete(row._id);
    const t1 = await ctx.db.insert("tokens", { userId: row.userId, tokenHash: args.searchHash, kind: "search", label: "Browser (signed in with a code)", hint: args.searchHint });
    const t2 = await ctx.db.insert("tokens", { userId: row.userId, tokenHash: args.apiHash, kind: "api", label: "Web app (signed in with a code)", hint: args.apiHint });
    await edgeChanged(ctx, ["tokens", t1], ["tokens", t2]);
  },
});
