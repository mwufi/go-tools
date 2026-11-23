// Platform-neutral edge handler shared by the Cloudflare Worker and the
// Cloud Run server. Answers /s and /suggest from a cached snapshot of the
// user's shortcuts and proxies everything else to the Convex deployment.
import { resolveWith, snapshotSource, type Snapshot } from "../convex/lib/core";
import { sha256Hex } from "../convex/lib/sha256";

export type Entry = { snap: Snapshot; fetched: number };

export interface Platform {
  convexSite: string; // e.g. https://tame-crow-881.convex.site
  /** Second-tier cache shared by isolates in one place (Cloudflare colo cache); optional. */
  getShared?(key: string): Promise<Entry | null>;
  putShared?(key: string, e: Entry): Promise<void>;
  /** Run work after the response is sent. */
  background(p: Promise<unknown>): void;
}

const mem = new Map<string, Entry>(); // per isolate / per instance: fastest tier
const REVALIDATE_MS = 2_000; // refresh in the background at most this often per user
const MAX_ENTRIES = 5_000;

const keyFor = (t: string | null) => (t ? sha256Hex("edge:" + t) : "anon");

async function fetchSnapshot(p: Platform, t: string | null, key: string): Promise<Entry | null> {
  const res = await fetch(`${p.convexSite}/api/snapshot${t ? `?t=${encodeURIComponent(t)}` : ""}`);
  if (!res.ok) return null;
  const entry = { snap: (await res.json()) as Snapshot, fetched: Date.now() };
  if (mem.size >= MAX_ENTRIES) mem.delete(mem.keys().next().value!);
  mem.set(key, entry);
  await p.putShared?.(key, entry);
  return entry;
}

async function load(p: Platform, t: string | null, force = false): Promise<Snapshot | null> {
  const key = keyFor(t);
  if (force) return (await fetchSnapshot(p, t, key))?.snap ?? null;
  let hit = mem.get(key);
  if (!hit && p.getShared) {
    hit = (await p.getShared(key)) ?? undefined;
    if (hit) mem.set(key, hit);
  }
  if (!hit) return (await fetchSnapshot(p, t, key))?.snap ?? null;
  if (Date.now() - hit.fetched > REVALIDATE_MS) {
    hit.fetched = Date.now(); // one background refresh at a time
    p.background(fetchSnapshot(p, t, key).catch(() => undefined));
  }
  return hit.snap;
}

const redirect = (url: string, timing: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Server-Timing": timing },
  });

async function proxy(p: Platform, req: Request, url: URL): Promise<Response> {
  const init: RequestInit & { duplex?: string } = { method: req.method, headers: req.headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }
  const headers = new Headers(req.headers);
  headers.delete("host");
  init.headers = headers;
  return fetch(p.convexSite + url.pathname + url.search, init);
}

export async function handle(req: Request, p: Platform): Promise<Response> {
  const url = new URL(req.url);
  const t = url.searchParams.get("t");

  if (url.pathname === "/s" && req.method === "GET") {
    const started = Date.now();
    const snap = await load(p, t);
    if (!snap) return proxy(p, req, url); // unknown token etc: let Convex answer
    const q = url.searchParams.get("q") ?? "";
    const r = await resolveWith(snapshotSource(snap), q, snap.llm && !url.searchParams.has("nollm"));
    const timing = `edge;dur=${Date.now() - started};desc="snapshot age ${Math.round((Date.now() - snap.at) / 1000)}s"`;
    const tq = t ? `&t=${encodeURIComponent(t)}` : "";
    switch (r.kind) {
      case "redirect":
        if (r.linkId && t && Math.random() < 0.1) {
          p.background(fetch(`${p.convexSite}/api/click`, { method: "POST", body: JSON.stringify({ t, linkId: r.linkId, by: 10 }) }));
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
  // edge location (or instance) serving this person's searches has the new shortcuts.
  if (url.pathname === "/_refresh") {
    await load(p, t, true);
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
  }

  if (url.pathname === "/_health") return new Response("ok");

  if (url.pathname === "/suggest" && req.method === "GET") {
    const snap = await load(p, t);
    const q = url.searchParams.get("q") ?? "";
    const prefix = q.trim().toLowerCase().replace(/^go\//, "").replace(/\s+/g, " ");
    const seen = new Set<string>();
    if (snap && prefix) {
      for (const scope of snap.scopes)
        for (const l of snap.links) if (l.scopeId === scope && l.keyword.startsWith(prefix)) seen.add(l.keyword);
    }
    return new Response(JSON.stringify([q, [...seen].sort().slice(0, 8)]), {
      headers: { "Content-Type": "application/x-suggestions+json", "Cache-Control": "no-store" },
    });
  }

  return proxy(p, req, url);
}
