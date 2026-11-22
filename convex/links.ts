import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireMember, requireUser, teamIdsFor } from "./lib/auth";
import { normalizeKeyword, validateKeyword, validateUrl } from "./lib/go";

const scopeArg = v.union(v.literal("user"), v.object({ teamId: v.id("teams") }));

type LinkOut = Doc<"links"> & { ownerName: string | null; scopeName: string };

async function decorate(ctx: QueryCtx, links: Doc<"links">[]): Promise<LinkOut[]> {
  const names = new Map<string, string>();
  const nameOf = async (id: string, kind: "users" | "teams") => {
    if (!names.has(id)) {
      const d = await ctx.db.get(id as Id<"users"> | Id<"teams">);
      names.set(id, d ? (d as Doc<"users"> | Doc<"teams">).name : "?");
    }
    return names.get(id)!;
  };
  const out = [];
  for (const l of links) {
    out.push({
      ...l,
      ownerName: l.ownerId ? await nameOf(l.ownerId, "users") : null,
      scopeName: l.scope === "global" ? "Everyone" : l.scope === "user" ? "Just you" : await nameOf(l.scopeId, "teams"),
    });
  }
  return out;
}

async function canEdit(ctx: QueryCtx, user: Doc<"users">, link: Doc<"links">, deleting = false) {
  if (link.scope === "global") throw new Error("Built-in shortcuts can't be changed; add your own with the same keyword to override it");
  if (link.scope === "user") {
    if (link.scopeId !== user._id) throw new Error("Not your shortcut");
    return;
  }
  const m = await requireMember(ctx, user, link.scopeId as Id<"teams">);
  if (deleting && m.role !== "admin" && link.ownerId !== user._id)
    throw new Error("Only the owner or a team admin can delete a team shortcut");
}

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx, token);
    const teamIds = await teamIdsFor(ctx, user);
    const scopes = [user._id as string, ...teamIds.map(String), "global"];
    const all: Doc<"links">[] = [];
    for (const s of scopes) {
      all.push(...(await ctx.db.query("links").withIndex("by_scope_keyword", (q) => q.eq("scopeId", s)).collect()));
    }
    return await decorate(ctx, all);
  },
});

/** Everything about one keyword: each scope that defines it (winner first) and its history. */
export const info = query({
  args: { token: v.string(), keyword: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const keyword = normalizeKeyword(args.keyword);
    const teamIds = await teamIdsFor(ctx, user);
    const scopes = [user._id as string, ...teamIds.map(String), "global"];
    const found: Doc<"links">[] = [];
    for (const s of scopes) {
      const l = await ctx.db
        .query("links")
        .withIndex("by_scope_keyword", (q) => q.eq("scopeId", s).eq("keyword", keyword))
        .unique();
      if (l) found.push(l);
    }
    const links = await decorate(ctx, found);
    const history = [];
    for (const l of found) {
      const revs = await ctx.db.query("linkRevisions").withIndex("by_link", (q) => q.eq("linkId", l._id)).order("desc").take(20);
      for (const r of revs) {
        const editor = r.editedBy ? await ctx.db.get(r.editedBy) : null;
        history.push({ ...r, editorName: editor?.name ?? "go-tools" });
      }
    }
    history.sort((a, b) => b._creationTime - a._creationTime);
    return { keyword, links, history };
  },
});

async function writeRevision(ctx: MutationCtx, link: Doc<"links">, userId: Id<"users"> | undefined, action: Doc<"linkRevisions">["action"]) {
  await ctx.db.insert("linkRevisions", {
    linkId: link._id,
    keyword: link.keyword,
    url: link.url,
    description: link.description,
    editedBy: userId,
    action,
  });
}

export async function upsertLink(
  ctx: MutationCtx,
  user: Doc<"users"> | null,
  scope: { scope: Doc<"links">["scope"]; scopeId: string },
  fields: { keyword: string; url: string; description?: string; emptyUrl?: string },
) {
  const keyword = validateKeyword(fields.keyword);
  const url = validateUrl(fields.url);
  const emptyUrl = fields.emptyUrl?.trim() ? validateUrl(fields.emptyUrl) : undefined;
  const description = (fields.description ?? "").trim().slice(0, 200);
  const existing = await ctx.db
    .query("links")
    .withIndex("by_scope_keyword", (q) => q.eq("scopeId", scope.scopeId).eq("keyword", keyword))
    .unique();
  const text = `${keyword} ${description}`;
  if (existing) {
    if (user) await canEdit(ctx, user, existing);
    if (existing.url === url && existing.emptyUrl === emptyUrl && existing.description === description)
      return { id: existing._id, created: false };
    await ctx.db.patch(existing._id, { url, emptyUrl, description, text, updatedAt: Date.now() });
    await writeRevision(ctx, (await ctx.db.get(existing._id))!, user?._id, "edit");
    return { id: existing._id, created: false };
  }
  const id = await ctx.db.insert("links", {
    ...scope,
    keyword,
    url,
    emptyUrl,
    description,
    text,
    ownerId: user?._id,
    updatedAt: Date.now(),
    clicks: 0,
  });
  await writeRevision(ctx, (await ctx.db.get(id))!, user?._id, "create");
  return { id, created: true };
}

export async function scopeFor(ctx: QueryCtx, user: Doc<"users">, scope: "user" | { teamId: Id<"teams"> }) {
  if (scope === "user") return { scope: "user" as const, scopeId: user._id as string };
  await requireMember(ctx, user, scope.teamId);
  return { scope: "team" as const, scopeId: scope.teamId as string };
}

export const save = mutation({
  args: {
    token: v.string(),
    scope: scopeArg,
    keyword: v.string(),
    url: v.string(),
    description: v.optional(v.string()),
    emptyUrl: v.optional(v.string()),
    previousId: v.optional(v.id("links")), // set when renaming/moving an existing shortcut
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const scope = await scopeFor(ctx, user, args.scope);
    if (args.previousId) {
      const prev = await ctx.db.get(args.previousId);
      if (prev && (prev.scopeId !== scope.scopeId || prev.keyword !== normalizeKeyword(args.keyword))) {
        await canEdit(ctx, user, prev, true);
        await writeRevision(ctx, prev, user._id, "delete");
        await ctx.db.delete(prev._id);
      }
    }
    return await upsertLink(ctx, user, scope, args);
  },
});

export const remove = mutation({
  args: { token: v.string(), linkId: v.id("links") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const link = await ctx.db.get(args.linkId);
    if (!link) return;
    await canEdit(ctx, user, link, true);
    await writeRevision(ctx, link, user._id, "delete");
    await ctx.db.delete(link._id);
  },
});

export const revert = mutation({
  args: { token: v.string(), revisionId: v.id("linkRevisions") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx, args.token);
    const rev = await ctx.db.get(args.revisionId);
    if (!rev) throw new Error("Revision not found");
    const link = await ctx.db.get(rev.linkId);
    if (!link) throw new Error("That shortcut was deleted; add it again from the history");
    await canEdit(ctx, user, link);
    await ctx.db.patch(link._id, {
      url: rev.url,
      description: rev.description,
      text: `${link.keyword} ${rev.description}`,
      updatedAt: Date.now(),
    });
    await writeRevision(ctx, (await ctx.db.get(link._id))!, user._id, "revert");
  },
});

/** Off the hot path: scheduled by the redirect after it has answered. */
export const bump = internalMutation({
  args: { linkId: v.id("links"), by: v.optional(v.number()) },
  handler: async (ctx, { linkId, by }) => {
    const l = await ctx.db.get(linkId);
    if (l) await ctx.db.patch(linkId, { clicks: l.clicks + (by ?? 1) });
  },
});

/** Shortcuts most related to a query, for the LLM prompt and suggestions. */
export const related = query({
  args: { token: v.optional(v.string()), q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = args.token ? await requireUser(ctx, args.token).catch(() => null) : null;
    const scopes = ["global", ...(user ? [user._id as string, ...(await teamIdsFor(ctx, user)).map(String)] : [])];
    const out: Doc<"links">[] = [];
    for (const s of scopes) {
      out.push(
        ...(await ctx.db
          .query("links")
          .withSearchIndex("search_text", (q) => q.search("text", args.q).eq("scopeId", s))
          .take(args.limit ?? 10)),
      );
    }
    return out.map((l) => ({ keyword: l.keyword, url: l.url, description: l.description, scope: l.scope }));
  },
});
