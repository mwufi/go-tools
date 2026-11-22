import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { sha256Hex } from "./sha256";

export function hashToken(token: string): string {
  return sha256Hex("go-tools:" + token.trim());
}

/** Look up a user by token hash. Search tokens can only resolve; API tokens can do everything. */
export async function userByHash(
  ctx: QueryCtx,
  tokenHash: string | undefined,
  needApi = false,
): Promise<Doc<"users"> | null> {
  if (!tokenHash) return null;
  const row = await ctx.db
    .query("tokens")
    .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
    .unique();
  if (!row) return null;
  if (needApi && row.kind !== "api") return null;
  return await ctx.db.get(row.userId);
}

export async function requireUser(ctx: QueryCtx, token: string): Promise<Doc<"users">> {
  const user = await userByHash(ctx, hashToken(token), true);
  if (!user) throw new Error("Not signed in (unknown or revoked token)");
  return user;
}

export async function teamIdsFor(ctx: QueryCtx, user: Doc<"users">): Promise<Id<"teams">[]> {
  const rows = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  const ids = rows.map((r) => r.teamId);
  // Primary team first, so it wins a keyword clash between two teams.
  ids.sort((a, b) => (a === user.primaryTeamId ? -1 : b === user.primaryTeamId ? 1 : 0));
  return ids;
}

export async function requireMember(
  ctx: QueryCtx,
  user: Doc<"users">,
  teamId: Id<"teams">,
): Promise<Doc<"members">> {
  const m = await ctx.db
    .query("members")
    .withIndex("by_team_user", (q) => q.eq("teamId", teamId).eq("userId", user._id))
    .unique();
  if (!m) throw new Error("You are not on that team");
  return m;
}
