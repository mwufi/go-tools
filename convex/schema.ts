import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    // Per-user template variables, e.g. { github: "mwufi" } -> {me.github}
    vars: v.record(v.string(), v.string()),
    fallbackSearch: v.string(), // key of SEARCH_ENGINES or a URL template with {*}
    llmEnabled: v.boolean(),
    llmMy: v.boolean(), // also ask the LLM for unmatched "my ..." queries
    primaryTeamId: v.optional(v.id("teams")),
    firstSearchAt: v.optional(v.number()), // set by the first search we hear about: setup works
    trackMisses: v.optional(v.boolean()), // false = don't keep missed searches (default on)
  }),

  tokens: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    kind: v.union(v.literal("search"), v.literal("api")),
    label: v.string(),
    hint: v.string(), // last 4 chars, to tell tokens apart in the UI
  })
    .index("by_hash", ["tokenHash"])
    .index("by_user", ["userId"]),

  teams: defineTable({
    slug: v.string(),
    name: v.string(),
    vars: v.record(v.string(), v.string()),
    joinCodeHash: v.string(),
    about: v.optional(v.string()),
    avatarId: v.optional(v.id("_storage")),
    headerId: v.optional(v.id("_storage")),
  }).index("by_slug", ["slug"]).index("by_join", ["joinCodeHash"]),

  members: defineTable({
    teamId: v.id("teams"),
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("member")),
  })
    .index("by_user", ["userId"])
    .index("by_team", ["teamId"])
    .index("by_team_user", ["teamId", "userId"]),

  links: defineTable({
    scope: v.union(v.literal("global"), v.literal("team"), v.literal("user")),
    scopeId: v.string(), // "global" | teamId | userId
    keyword: v.string(), // normalized: lowercase, single spaces, 1-3 words
    url: v.string(),
    emptyUrl: v.optional(v.string()),
    description: v.string(),
    ownerId: v.optional(v.id("users")),
    updatedAt: v.number(),
    clicks: v.number(),
    text: v.string(), // keyword + description, for the search index
  })
    .index("by_scope_keyword", ["scopeId", "keyword"])
    .searchIndex("search_text", { searchField: "text", filterFields: ["scopeId"] }),

  linkRevisions: defineTable({
    linkId: v.id("links"),
    keyword: v.string(),
    url: v.string(),
    description: v.string(),
    editedBy: v.optional(v.id("users")),
    action: v.union(v.literal("create"), v.literal("edit"), v.literal("delete"), v.literal("revert")),
  }).index("by_link", ["linkId"]),

  learned: defineTable({
    userId: v.id("users"),
    queryNorm: v.string(),
    url: v.string(),
    why: v.string(),
    model: v.string(),
    kept: v.boolean(),
    ms: v.number(),
  }).index("by_user_query", ["userId", "queryNorm"]),

  // Searches per person per UTC day, for "your week" on the home page.
  // shortcuts is sampled (1 in 10, counted as 10), web counts every miss.
  usage: defineTable({
    userId: v.id("users"),
    day: v.string(), // YYYY-MM-DD, UTC
    shortcuts: v.number(),
    web: v.number(),
  }).index("by_user_day", ["userId", "day"]),

  // One- and two-word queries that found no shortcut, kept 30 days so we can
  // suggest making one ("you searched standup 4 times"). Private to the person;
  // teams only see keywords that several teammates tried, as a count.
  misses: defineTable({
    userId: v.id("users"),
    query: v.string(), // normalized
    count: v.number(),
    lastAt: v.number(),
    dismissed: v.boolean(),
  })
    .index("by_user_query", ["userId", "query"])
    .index("by_user_last", ["userId", "lastAt"])
    .index("by_last", ["lastAt"]),

  // One-time codes for signing in on another device (10 minutes, single use).
  loginCodes: defineTable({
    userId: v.id("users"),
    codeHash: v.string(),
    expiresAt: v.number(),
  }).index("by_hash", ["codeHash"]),

  // Numbered change feed for the edges (see edge.ts). row null = deleted.
  edgeLog: defineTable({
    seq: v.number(),
    table: v.union(v.literal("links"), v.literal("users"), v.literal("tokens"), v.literal("teams"), v.literal("learned")),
    id: v.string(),
    row: v.any(),
  }).index("by_seq", ["seq"]),
});
