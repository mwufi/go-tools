import { edgeChanged } from "./edge";
import { v } from "convex/values";
import { internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { userByHash, teamIdsFor } from "./lib/auth";
import { fillTemplate, normalizeQuery, searchUrl } from "./lib/go";
import { RECIPES } from "./lib/recipes";

export const llmAvailable = () => !!process.env.LLM_API_KEY;

/** Everything the prompt needs, in one query. Null when the user can't use the LLM. */
export const context = internalQuery({
  args: { tokenHash: v.string(), q: v.string() },
  handler: async (ctx, args) => {
    const user = await userByHash(ctx, args.tokenHash);
    if (!user) return null;
    const teamIds = await teamIdsFor(ctx, user);
    const primary = user.primaryTeamId ?? teamIds[0];
    const team = primary ? await ctx.db.get(primary) : null;
    const scopes = [user._id as string, ...teamIds.map(String), "global"];
    const seen = new Set<string>();
    const shortcuts: Pick<Doc<"links">, "keyword" | "url" | "description">[] = [];
    for (const s of scopes) {
      const hits = await ctx.db
        .query("links")
        .withSearchIndex("search_text", (q) => q.search("text", args.q).eq("scopeId", s))
        .take(12);
      for (const l of hits) {
        if (seen.has(l.keyword)) continue;
        seen.add(l.keyword);
        shortcuts.push({ keyword: l.keyword, url: l.url, description: l.description });
      }
    }
    return {
      userId: user._id,
      enabled: user.llmEnabled,
      fallbackSearch: user.fallbackSearch,
      me: user.vars,
      team: team?.vars ?? {},
      shortcuts: shortcuts.slice(0, 30),
    };
  },
});

export const record = internalMutation({
  args: { userId: v.id("users"), q: v.string(), url: v.string(), why: v.string(), model: v.string(), ms: v.number() },
  handler: async (ctx, a) => {
    return await ctx.db.insert("learned", {
      userId: a.userId,
      queryNorm: normalizeQuery(a.q),
      url: a.url,
      why: a.why,
      model: a.model,
      ms: a.ms,
      kept: false,
    });
  },
});

export const keep = internalMutation({
  args: { tokenHash: v.string(), learnedId: v.id("learned") },
  handler: async (ctx, a) => {
    const user = await userByHash(ctx, a.tokenHash);
    const row = await ctx.db.get(a.learnedId);
    if (!user || !row || row.userId !== user._id) throw new Error("Not yours");
    await ctx.db.patch(row._id, { kept: true });
    await edgeChanged(ctx, ["learned", row._id]);
  },
});

const SYSTEM = `You turn a short browser query into the single best URL to open.
The user typed it into their address bar, which points at their personal go-links tool.
Prefer, in order: one of their shortcuts (fill its {*} / {1} placeholders yourself), a recipe below, a well-known site's own URL.
Use the user's variables instead of guessing names. Never invent private hostnames.
If the query is really just a web search, answer with confidence below 0.3.
Reply with JSON only: {"url": "...", "why": "<= 12 words", "confidence": 0..1, "saveAs": "<1-3 word keyword or empty>"}`;

type Answer = { url: string; why: string; confidence: number; saveAs: string };

async function callModel(prompt: string, signal: AbortSignal): Promise<{ text: string; model: string }> {
  const provider = process.env.LLM_PROVIDER ?? "anthropic";
  const key = process.env.LLM_API_KEY!;
  if (provider === "anthropic") {
    const model = process.env.LLM_MODEL ?? "claude-haiku-5-5";
    const res = await fetch(process.env.LLM_BASE_URL ?? "https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system: SYSTEM,
        messages: [
          { role: "user", content: prompt },
          { role: "assistant", content: "{" },
        ],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { content: { type: string; text?: string }[] };
    return { text: "{" + body.content.map((c) => c.text ?? "").join(""), model };
  }
  // Any OpenAI-compatible endpoint: OpenAI, Groq, OpenRouter, Together, a local server...
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  const base = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  return { text: body.choices[0]?.message.content ?? "", model };
}

function parseAnswer(text: string): Answer | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const a = JSON.parse(m[0]);
    if (typeof a.url !== "string") return null;
    return {
      url: a.url,
      why: String(a.why ?? "").slice(0, 120),
      confidence: Number(a.confidence ?? 0),
      saveAs: String(a.saveAs ?? "").slice(0, 40),
    };
  } catch {
    return null;
  }
}

export type ThinkResult = {
  url: string;
  fallback: boolean;
  why: string;
  saveAs: string;
  learnedId: string | null;
  ms: number;
  model: string;
  error?: string;
};

/** Called by the thinking page through POST /api/think. Always returns somewhere to go. */
export async function think(ctx: ActionCtx, tokenHash: string, q: string): Promise<ThinkResult> {
  const started = Date.now();
  const c = await ctx.runQuery(internal.llm.context, { tokenHash, q });
  const search = searchUrl(c?.fallbackSearch ?? "google", q);
  const fail = (error?: string): ThinkResult => ({
    url: search, fallback: true, why: "", saveAs: "", learnedId: null, ms: Date.now() - started, model: "", error,
  });
  if (!c || !c.enabled || !llmAvailable()) return fail("LLM is off");

  const prompt = [
    `Query: ${q}`,
    `User variables (me.*): ${JSON.stringify(c.me)}`,
    `Team variables (team.*): ${JSON.stringify(c.team)}`,
    `Their shortcuts:\n${c.shortcuts.map((s) => `- ${s.keyword}: ${s.url}${s.description ? ` (${s.description})` : ""}`).join("\n") || "(none matched)"}`,
    `Recipes:\n${RECIPES}`,
  ].join("\n\n");

  const timeout = Number(process.env.LLM_TIMEOUT_MS ?? 2500);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeout);
  let model = "";
  try {
    const out = await callModel(prompt, abort.signal);
    model = out.model;
    const a = parseAnswer(out.text);
    if (!a) return fail("Unreadable answer");
    // Fill any placeholders the model left in, from the user's own variables.
    const url = fillTemplate(a.url, [], { me: c.me, team: c.team }) ?? a.url;
    if (!/^https:\/\//.test(url) || a.confidence < 0.35) return { ...fail("Low confidence"), model };
    const ms = Date.now() - started;
    const learnedId = await ctx.runMutation(internal.llm.record, { userId: c.userId, q, url, why: a.why, model, ms });
    return { url, fallback: false, why: a.why, saveAs: a.saveAs, learnedId, ms, model };
  } catch (e) {
    return { ...fail(abort.signal.aborted ? `Timed out after ${timeout} ms` : String(e).slice(0, 200)), model };
  } finally {
    clearTimeout(timer);
  }
}
