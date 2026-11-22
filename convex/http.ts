import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hashToken } from "./lib/auth";
import { llmAvailable, think } from "./llm";
import { APP_HTML, THINK_HTML } from "./lib/assets";

const http = httpRouter();

const redirect = (url: string) =>
  new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const config = () =>
  `<script>window.__GO__=${JSON.stringify({ convexUrl: process.env.CONVEX_CLOUD_URL, siteUrl: process.env.CONVEX_SITE_URL, llm: llmAvailable() })}</script>`;

const html = (page: string) =>
  new Response(page.replace("<!--GO_CONFIG-->", config()), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "Referrer-Policy": "no-referrer" },
  });

// ---------------------------------------------------------------- hot path
http.route({
  path: "/s",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const u = new URL(req.url);
    const q = u.searchParams.get("q") ?? "";
    const t = u.searchParams.get("t") ?? undefined;
    const tokenHash = t ? hashToken(t) : undefined;
    const noLlm = u.searchParams.has("nollm"); // "search instead" link on the thinking page
    const r = await ctx.runQuery(internal.resolve.resolve, { tokenHash, q, llmAvailable: llmAvailable() && !noLlm });
    const site = u.origin;
    switch (r.kind) {
      case "redirect":
        // Scheduling the click-count write costs ~13 ms, so only 1 in 10 redirects
        // pays it and counts for 10. Counts are approximate; redirects stay fast.
        if (r.linkId && Math.random() < 0.1) await ctx.scheduler.runAfter(0, internal.links.bump, { linkId: r.linkId, by: 10 });
        return redirect(r.url);
      case "search":
        return redirect(r.url);
      case "think":
        return redirect(`${site}/think?q=${encodeURIComponent(r.q)}${t ? `&t=${encodeURIComponent(t)}` : ""}`);
      case "create":
        return redirect(`${site}/new?k=${encodeURIComponent(r.keyword)}`);
      case "info":
        return redirect(`${site}/i/${encodeURIComponent(r.keyword)}`);
      case "home":
        return redirect(`${site}/`);
    }
  }),
});

// OpenSearch suggestions for the address-bar dropdown.
http.route({
  path: "/suggest",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const u = new URL(req.url);
    const q = u.searchParams.get("q") ?? "";
    const t = u.searchParams.get("t");
    const rows = await ctx.runQuery(internal.resolve.suggest, { tokenHash: t ? hashToken(t) : undefined, q });
    return new Response(
      JSON.stringify([q, rows.map((r) => r.keyword), rows.map((r) => r.description), []]),
      { headers: { "Content-Type": "application/x-suggestions+json", "Cache-Control": "no-store" } },
    );
  }),
});

http.route({
  path: "/opensearch.xml",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const u = new URL(req.url);
    const t = u.searchParams.get("t");
    const tq = t ? `&amp;t=${encodeURIComponent(t)}` : "";
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>go</ShortName>
  <Description>Shortcuts, then the web</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Url type="text/html" method="get" template="${u.origin}/s?q={searchTerms}${tq}"/>
  <Url type="application/x-suggestions+json" method="get" template="${u.origin}/suggest?q={searchTerms}${tq}"/>
</OpenSearchDescription>`;
    return new Response(xml, { headers: { "Content-Type": "application/opensearchdescription+xml" } });
  }),
});

// ---------------------------------------------------------------- LLM path
http.route({ path: "/think", method: "GET", handler: httpAction(async () => html(THINK_HTML)) });

http.route({
  path: "/api/think",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await req.json().catch(() => ({}))) as { q?: string; t?: string };
    if (!body.q) return json({ error: "q is required" }, 400);
    return json(await think(ctx, hashToken(body.t ?? ""), body.q));
  }),
});

http.route({
  path: "/api/keep",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = (await req.json().catch(() => ({}))) as { t?: string; learnedId?: string };
    if (!body.t || !body.learnedId) return json({ error: "t and learnedId are required" }, 400);
    await ctx.runMutation(internal.llm.keep, { tokenHash: hashToken(body.t), learnedId: body.learnedId as Id<"learned"> });
    return json({ ok: true });
  }),
});

// ---------------------------------------------------------------- JSON API (CLI, agents)
function bearer(req: Request): string | null {
  const h = req.headers.get("Authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

const apiError = (e: unknown) => json({ error: String((e as Error)?.message ?? e).replace(/^.*Uncaught Error: /s, "").split("\n")[0] }, 400);

http.route({
  path: "/api/links",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const token = bearer(req);
    if (!token) return json({ error: "Send Authorization: Bearer <api token>" }, 401);
    try {
      const links = await ctx.runQuery(api.links.list, { token });
      return json(links.map((l) => ({ id: l._id, keyword: l.keyword, url: l.url, description: l.description, scope: l.scopeName, clicks: l.clicks })));
    } catch (e) {
      return apiError(e);
    }
  }),
});

http.route({
  path: "/api/links",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const token = bearer(req);
    if (!token) return json({ error: "Send Authorization: Bearer <api token>" }, 401);
    const b = (await req.json().catch(() => ({}))) as { keyword?: string; url?: string; description?: string; team?: string };
    try {
      let scope: "user" | { teamId: Id<"teams"> } = "user";
      if (b.team) {
        const me = await ctx.runQuery(api.users.me, { token });
        const team = me?.teams.find((t) => t.slug === b.team || t.name === b.team);
        if (!team) return json({ error: `You're not on a team called ${b.team}` }, 400);
        scope = { teamId: team._id };
      }
      const r = await ctx.runMutation(api.links.save, { token, scope, keyword: b.keyword ?? "", url: b.url ?? "", description: b.description });
      return json(r);
    } catch (e) {
      return apiError(e);
    }
  }),
});

http.route({
  path: "/api/links",
  method: "DELETE",
  handler: httpAction(async (ctx, req) => {
    const token = bearer(req);
    if (!token) return json({ error: "Send Authorization: Bearer <api token>" }, 401);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return json({ error: "id is required" }, 400);
    try {
      await ctx.runMutation(api.links.remove, { token, linkId: id as Id<"links"> });
      return json({ ok: true });
    } catch (e) {
      return apiError(e);
    }
  }),
});

http.route({
  path: "/api/resolve",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const token = bearer(req);
    return json(await ctx.runQuery(internal.resolve.resolve, { tokenHash: token ? hashToken(token) : undefined, q, llmAvailable: llmAvailable() }));
  }),
});

// ---------------------------------------------------------------- web app (everything else)
http.route({ pathPrefix: "/", method: "GET", handler: httpAction(async () => html(APP_HTML)) });

export default http;
