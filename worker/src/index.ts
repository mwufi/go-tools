// go-tools edge Worker. Answers /s redirects from a cached snapshot of the
// user's shortcuts, at the Cloudflare location nearest the browser, and
// refreshes that snapshot from Convex in the background. Everything else
// (web app, thinking page, API) is proxied to the Convex deployment.
import { resolveWith, snapshotSource, type Snapshot } from "../../convex/lib/core";
import { sha256Hex } from "../../convex/lib/sha256";

interface Env {
  CONVEX_SITE: string; // e.g. https://tame-crow-881.convex.site
}

type Entry = { snap: Snapshot; fetched: number };
const mem = new Map<string, Entry>(); // per isolate: fastest tier
const REVALIDATE_MS = 2_000; // refresh in the background at most this often per user
const CACHE_HOST = "https://go-snapshot.internal/";

const keyFor = (t: string | null) => (t ? sha256Hex("edge:" + t) : "anon");

async function fetchSnapshot(env: Env, t: string | null, key: string): Promise<Entry | null> {
  const res = await fetch(`${env.CONVEX_SITE}/api/snapshot${t ? `?t=${encodeURIComponent(t)}` : ""}`);
  if (!res.ok) return null;
  const entry = { snap: (await res.json()) as Snapshot, fetched: Date.now() };
  mem.set(key, entry);
  await caches.default.put(
    CACHE_HOST + key,
    new Response(JSON.stringify(entry), { headers: { "content-type": "application/json", "cache-control": "max-age=2592000" } }),
  );
  return entry;
}

async function load(env: Env, ctx: ExecutionContext, t: string | null, force = false): Promise<Snapshot | null> {
  const key = keyFor(t);
  if (force) return (await fetchSnapshot(env, t, key))?.snap ?? null;
  let hit = mem.get(key);
  if (!hit) {
    const cached = await caches.default.match(CACHE_HOST + key);
    if (cached) {
      hit = (await cached.json()) as Entry;
      mem.set(key, hit);
    }
  }
  if (!hit) return (await fetchSnapshot(env, t, key))?.snap ?? null;
  if (Date.now() - hit.fetched > REVALIDATE_MS) {
    hit.fetched = Date.now(); // one background refresh at a time
    ctx.waitUntil(fetchSnapshot(env, t, key).catch(() => undefined));
  }
  return hit.snap;
}

const redirect = (url: string, timing: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Server-Timing": timing },
  });

const proxy = (env: Env, req: Request, url: URL) =>
  fetch(new Request(env.CONVEX_SITE + url.pathname + url.search, req));

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const t = url.searchParams.get("t");

    if (url.pathname === "/s" && req.method === "GET") {
      const started = Date.now();
      const snap = await load(env, ctx, t);
      if (!snap) return proxy(env, req, url); // unknown token etc: let Convex answer
      const q = url.searchParams.get("q") ?? "";
      const r = await resolveWith(snapshotSource(snap), q, snap.llm && !url.searchParams.has("nollm"));
      const timing = `edge;dur=${Date.now() - started};desc="snapshot age ${Math.round((Date.now() - snap.at) / 1000)}s"`;
      const tq = t ? `&t=${encodeURIComponent(t)}` : "";
      switch (r.kind) {
        case "redirect":
          if (r.linkId && t && Math.random() < 0.1) {
            ctx.waitUntil(fetch(`${env.CONVEX_SITE}/api/click`, { method: "POST", body: JSON.stringify({ t, linkId: r.linkId, by: 10 }) }));
          }
          return redirect(r.url, timing);
        case "search":
          return redirect(r.url, timing);
        case "think":
          return redirect(`${url.origin}/think?q=${encodeURIComponent(r.q)}${tq}`, timing);
        case "create":
          return redirect(`${url.origin}/new?k=${encodeURIComponent(r.keyword)}`, timing);
        case "info":
          return redirect(`${url.origin}/i/${encodeURIComponent(r.keyword)}`, timing);
        case "home":
          return redirect(`${url.origin}/`, timing);
      }
    }

    // The web app calls this after every change, from the same browser, so the
    // edge location that serves this person's searches has the new shortcuts.
    if (url.pathname === "/_refresh") {
      await load(env, ctx, t, true);
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
    }

    if (url.pathname === "/suggest" && req.method === "GET") {
      const snap = await load(env, ctx, t);
      const q = url.searchParams.get("q") ?? "";
      const prefix = q.trim().toLowerCase().replace(/^go\//, "").replace(/\s+/g, " ");
      const seen = new Map<string, string>();
      if (snap && prefix) {
        for (const scope of snap.scopes)
          for (const l of snap.links)
            if (l.scopeId === scope && l.keyword.startsWith(prefix) && !seen.has(l.keyword)) seen.set(l.keyword, l.keyword);
      }
      const kws = [...seen.keys()].sort().slice(0, 8);
      return new Response(JSON.stringify([q, kws]), { headers: { "Content-Type": "application/x-suggestions+json", "Cache-Control": "no-store" } });
    }

    return proxy(env, req, url);
  },
} satisfies ExportedHandler<Env>;
