// Platform-neutral edge handler shared by the Cloudflare Worker and the
// Cloud Run server. Answers /s and /suggest from a local copy of the
// shortcuts and proxies everything else to the Convex deployment.
//
// The copy is kept current by push: when something changes, Convex POSTs
// /_sync here, and we pull the changes since our last sequence number.
import { resolveWith } from "../convex/lib/core";
import { candidates, normalizeQuery, parseQuery } from "../convex/lib/go";
import { hashToken } from "../convex/lib/auth";
import { reportFor } from "../convex/lib/activity";
import type { ChangesPage, Dump } from "../convex/lib/edgeRows";
import type { Store } from "./store";

export interface Platform {
  convexSite: string; // e.g. https://tame-crow-881.convex.site
  syncSecret?: string; // EDGE_SYNC_SECRET, shared with Convex
  store: Store;
  /** Also check for missed pushes when serving a search, at most this often. */
  checkEveryMs: number;
  /** Run work after the response is sent. */
  background(p: Promise<unknown>): void;
}

let inflight: Promise<void> | null = null;
let lastSync = 0;

/** Pull whatever changed since our last sync. Concurrent calls share one pull. */
export function sync(p: Platform): Promise<void> {
  inflight ??= pull(p).finally(() => (inflight = null));
  return inflight;
}

async function pull(p: Platform) {
  lastSync = Date.now();
  const get = async <T>(path: string): Promise<T> => {
    const r = await fetch(p.convexSite + path, { headers: { Authorization: `Bearer ${p.syncSecret}` } });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return (await r.json()) as T;
  };
  let seq = await p.store.seq();
  for (let i = 0; i < 100; i++) {
    const page = await get<ChangesPage>(`/api/edge/changes?after=${seq}`);
    if (page.reset) {
      const d = await get<Dump>("/api/edge/dump");
      await p.store.replace(d);
      if (d.seq >= page.seq) return;
      seq = d.seq;
      continue;
    }
    seq = page.changes.at(-1)?.seq ?? page.seq;
    await p.store.apply(page.changes, seq, page.llm);
    if (!page.more) return;
  }
}

const redirect = (url: string, timing: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Server-Timing": timing },
  });

async function proxy(p: Platform, req: Request, url: URL): Promise<Response> {
  const headers = new Headers(req.headers);
  headers.delete("host");
  const init: RequestInit = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();
  return fetch(p.convexSite + url.pathname + url.search, init);
}

const noContent = () =>
  new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });

export async function handle(req: Request, p: Platform): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === "/_health") return new Response("ok");
  // Without the shared secret we can't sync, so act as a plain proxy.
  if (!p.syncSecret) return proxy(p, req, url);

  const t = url.searchParams.get("t");
  const tokenHash = t ? hashToken(t) : null;

  if (url.pathname === "/s" && req.method === "GET") {
    const started = Date.now();
    const q = url.searchParams.get("q") ?? "";
    const parsed = parseQuery(q);
    const keywords = parsed.kind === "query" ? candidates(parsed.lower).map((c) => c.keyword) : [];
    const queryNorm = parsed.kind === "query" ? normalizeQuery(parsed.raw) : null;

    let found = await p.store.lookup(tokenHash, keywords, queryNorm);
    if (found === "empty") {
      await sync(p).catch((e) => console.error("sync", e)); // first request after a deploy
      found = await p.store.lookup(tokenHash, keywords, queryNorm);
    } else if (Date.now() - lastSync > p.checkEveryMs) {
      p.background(sync(p).catch((e) => console.error("sync", e)));
    }
    if (typeof found === "string") return proxy(p, req, url); // unknown token or no data: let Convex answer

    const r = await resolveWith(found.src, q, found.llm && !url.searchParams.has("nollm"));
    const timing = `edge;dur=${Date.now() - started}`;
    const tq = t ? `&t=${encodeURIComponent(t)}` : "";
    // Misses, 1 in 10 hits and a daily check-in go back to Convex after we answer (lib/activity.ts).
    const linkId = r.kind === "redirect" ? r.linkId : undefined;
    const rep = t ? reportFor(tokenHash, q, r.kind, !!linkId) : null;
    if (rep) p.background(fetch(`${p.convexSite}/api/seen`, { method: "POST", body: JSON.stringify({ t, ...rep, linkId }) }).catch(() => undefined));
    switch (r.kind) {
      case "redirect":
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

  // Convex calls this after every change.
  if (url.pathname === "/_sync" && req.method === "POST") {
    if (req.headers.get("authorization") !== `Bearer ${p.syncSecret}`) return new Response("forbidden", { status: 403 });
    await sync(p);
    return noContent();
  }

  // The web app calls this after an edit, so the instance serving this
  // person's searches is current even if Convex's poke reached another one.
  if (url.pathname === "/_refresh") {
    await sync(p).catch(() => undefined);
    return noContent();
  }

  if (url.pathname === "/suggest" && req.method === "GET") {
    const q = url.searchParams.get("q") ?? "";
    const prefix = q.trim().toLowerCase().replace(/^go\//, "").replace(/\s+/g, " ");
    const list = prefix ? await p.store.suggest(tokenHash, prefix).catch(() => []) : [];
    return new Response(JSON.stringify([q, list]), {
      headers: { "Content-Type": "application/x-suggestions+json", "Cache-Control": "no-store" },
    });
  }

  return proxy(p, req, url);
}
