var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// convex/lib/go.ts
var MAX_KEYWORD_WORDS = 3;
var SEARCH_ENGINES = {
  google: { name: "Google", url: "https://www.google.com/search?q={*}" },
  kagi: { name: "Kagi", url: "https://kagi.com/search?q={*}" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q={*}" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q={*}" },
  perplexity: { name: "Perplexity", url: "https://www.perplexity.ai/search?q={*}" }
};
function normalizeKeyword(raw) {
  return raw.trim().toLowerCase().replace(/^go\//, "").replace(/\s+/g, " ");
}
__name(normalizeKeyword, "normalizeKeyword");
function parseQuery(input) {
  let q = input.trim();
  let explicit = false;
  let askLlm = false;
  const m = /^go(\/|\s+)/i.exec(q);
  if (m) {
    explicit = true;
    q = q.slice(m[0].length).trim();
  } else if (/^go$/i.test(q)) {
    return { kind: "home" };
  }
  if (q.startsWith("?")) {
    askLlm = true;
    q = q.slice(1).trim();
  } else if (q.endsWith("!") && q.length > 1) {
    askLlm = true;
    q = q.slice(0, -1).trim();
  }
  if (!q) return { kind: "home" };
  if (!askLlm && /^\S+\+$/.test(q)) return { kind: "info", keyword: normalizeKeyword(q.slice(0, -1)) };
  const words = q.split(/\s+/);
  return { kind: "query", raw: q, words, lower: words.map((w) => w.toLowerCase()), explicit, askLlm };
}
__name(parseQuery, "parseQuery");
function candidates(lower) {
  const out = [];
  for (let n = Math.min(MAX_KEYWORD_WORDS, lower.length); n >= 1; n--) {
    out.push({ keyword: lower.slice(0, n).join(" "), n });
  }
  return out;
}
__name(candidates, "candidates");
function fillTemplate(template, args, vars) {
  const rest = args.join(" ");
  let missing = false;
  const queryStart = template.indexOf("?") === -1 ? Infinity : template.indexOf("?");
  const enc = /* @__PURE__ */ __name((s, at) => at < queryStart ? encodeURIComponent(s).replace(/%2F/gi, "/") : encodeURIComponent(s), "enc");
  const out = template.replace(/\{([^}]+)\}|%s/g, (whole, name, at) => {
    if (whole === "%s" || name === "*") {
      if (!rest) missing = true;
      return enc(rest, at);
    }
    if (/^\d+$/.test(name)) {
      const a = args[Number(name) - 1];
      if (a === void 0) missing = true;
      return enc(a ?? "", at);
    }
    const [ns, key] = name.split(".", 2);
    if ((ns === "me" || ns === "team") && key) {
      const val = vars[ns][key];
      if (val === void 0) missing = true;
      return encodeURIComponent(val ?? "");
    }
    return whole;
  });
  return missing ? null : out;
}
__name(fillTemplate, "fillTemplate");
function searchUrl(fallback, q) {
  const t = SEARCH_ENGINES[fallback]?.url ?? (fallback.includes("{*}") ? fallback : SEARCH_ENGINES.google.url);
  return t.replace("{*}", encodeURIComponent(q));
}
__name(searchUrl, "searchUrl");
function normalizeQuery(q) {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}
__name(normalizeQuery, "normalizeQuery");

// convex/lib/core.ts
async function resolveWith(src, q, llmAvailable) {
  const parsed = parseQuery(q);
  if (parsed.kind === "home") return { kind: "home" };
  if (parsed.kind === "info") return { kind: "info", keyword: parsed.keyword };
  const { user } = src;
  const primary = user?.primaryTeamId ?? src.scopes.find((s) => s !== user?.id && s !== "global");
  if (!parsed.askLlm) {
    for (const c of candidates(parsed.lower)) {
      for (const scopeId of src.scopes) {
        const link = await src.link(scopeId, c.keyword);
        if (!link) continue;
        const args = parsed.words.slice(c.n);
        const teamId = link.scope === "team" ? link.scopeId : primary;
        const vars = { me: user?.vars ?? {}, team: teamId ? await src.teamVars(teamId) : {} };
        let url = fillTemplate(link.url, args, vars);
        if (url === null && args.length === 0 && link.emptyUrl) url = fillTemplate(link.emptyUrl, [], vars);
        if (url === null) return { kind: "info", keyword: link.keyword };
        return { kind: "redirect", url, via: "shortcut", linkId: link.id, keyword: link.keyword, scope: link.scope };
      }
    }
  }
  if (user) {
    const kept = await src.learned(normalizeQuery(parsed.raw));
    if (kept) return { kind: "redirect", url: kept, via: "learned" };
  }
  const wantsLlm = parsed.askLlm || user?.llmMy === true && parsed.lower[0] === "my" && parsed.words.length > 1;
  if (wantsLlm && llmAvailable && user?.llmEnabled) return { kind: "think", q: parsed.raw };
  if (parsed.explicit && parsed.words.length === 1) return { kind: "create", keyword: parsed.lower[0] };
  return { kind: "search", url: searchUrl(user?.fallbackSearch ?? "google", parsed.raw) };
}
__name(resolveWith, "resolveWith");
function snapshotSource(s) {
  const byKey = /* @__PURE__ */ new Map();
  for (const l of s.links) byKey.set(`${l.scopeId}\0${l.keyword}`, l);
  return {
    user: s.user,
    scopes: s.scopes,
    teamVars: /* @__PURE__ */ __name((id) => s.teams[id] ?? {}, "teamVars"),
    link: /* @__PURE__ */ __name((scopeId, keyword) => byKey.get(`${scopeId}\0${keyword}`) ?? null, "link"),
    learned: /* @__PURE__ */ __name((qn) => s.learned[qn] ?? null, "learned")
  };
}
__name(snapshotSource, "snapshotSource");

// convex/lib/sha256.ts
var K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(bytes.length + 9 + 63 >> 6 << 6);
  padded.set(bytes);
  padded[bytes.length] = 128;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, bitLen >>> 0);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  const h = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a2 = w[i - 15], b2 = w[i - 2];
      const s0 = (a2 >>> 7 | a2 << 25) ^ (a2 >>> 18 | a2 << 14) ^ a2 >>> 3;
      const s1 = (b2 >>> 17 | b2 << 15) ^ (b2 >>> 19 | b2 << 13) ^ b2 >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = (e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7);
      const ch = e & f ^ ~e & g;
      const t1 = hh + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = (a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10);
      const maj = a & b ^ a & c ^ b & c;
      const t2 = S0 + maj >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a >>> 0;
    h[1] = h[1] + b >>> 0;
    h[2] = h[2] + c >>> 0;
    h[3] = h[3] + d >>> 0;
    h[4] = h[4] + e >>> 0;
    h[5] = h[5] + f >>> 0;
    h[6] = h[6] + g >>> 0;
    h[7] = h[7] + hh >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}
__name(sha256Hex, "sha256Hex");

// worker/src/index.ts
var mem = /* @__PURE__ */ new Map();
var REVALIDATE_MS = 2e3;
var CACHE_HOST = "https://go-snapshot.internal/";
var keyFor = /* @__PURE__ */ __name((t) => t ? sha256Hex("edge:" + t) : "anon", "keyFor");
async function fetchSnapshot(env, t, key) {
  const res = await fetch(`${env.CONVEX_SITE}/api/snapshot${t ? `?t=${encodeURIComponent(t)}` : ""}`);
  if (!res.ok) return null;
  const entry = { snap: await res.json(), fetched: Date.now() };
  mem.set(key, entry);
  await caches.default.put(
    CACHE_HOST + key,
    new Response(JSON.stringify(entry), { headers: { "content-type": "application/json", "cache-control": "max-age=2592000" } })
  );
  return entry;
}
__name(fetchSnapshot, "fetchSnapshot");
async function load(env, ctx, t, force = false) {
  const key = keyFor(t);
  if (force) return (await fetchSnapshot(env, t, key))?.snap ?? null;
  let hit = mem.get(key);
  if (!hit) {
    const cached = await caches.default.match(CACHE_HOST + key);
    if (cached) {
      hit = await cached.json();
      mem.set(key, hit);
    }
  }
  if (!hit) return (await fetchSnapshot(env, t, key))?.snap ?? null;
  if (Date.now() - hit.fetched > REVALIDATE_MS) {
    hit.fetched = Date.now();
    ctx.waitUntil(fetchSnapshot(env, t, key).catch(() => void 0));
  }
  return hit.snap;
}
__name(load, "load");
var redirect = /* @__PURE__ */ __name((url, timing) => new Response(null, {
  status: 302,
  headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Server-Timing": timing }
}), "redirect");
var proxy = /* @__PURE__ */ __name((env, req, url) => fetch(new Request(env.CONVEX_SITE + url.pathname + url.search, req)), "proxy");
var src_default = {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const t = url.searchParams.get("t");
    if (url.pathname === "/s" && req.method === "GET") {
      const started = Date.now();
      const snap = await load(env, ctx, t);
      if (!snap) return proxy(env, req, url);
      const q = url.searchParams.get("q") ?? "";
      const r = await resolveWith(snapshotSource(snap), q, snap.llm && !url.searchParams.has("nollm"));
      const timing = `edge;dur=${Date.now() - started};desc="snapshot age ${Math.round((Date.now() - snap.at) / 1e3)}s"`;
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
    if (url.pathname === "/_refresh") {
      await load(env, ctx, t, true);
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/suggest" && req.method === "GET") {
      const snap = await load(env, ctx, t);
      const q = url.searchParams.get("q") ?? "";
      const prefix = q.trim().toLowerCase().replace(/^go\//, "").replace(/\s+/g, " ");
      const seen = /* @__PURE__ */ new Map();
      if (snap && prefix) {
        for (const scope of snap.scopes)
          for (const l of snap.links)
            if (l.scopeId === scope && l.keyword.startsWith(prefix) && !seen.has(l.keyword)) seen.set(l.keyword, l.keyword);
      }
      const kws = [...seen.keys()].sort().slice(0, 8);
      return new Response(JSON.stringify([q, kws]), { headers: { "Content-Type": "application/x-suggestions+json", "Cache-Control": "no-store" } });
    }
    return proxy(env, req, url);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-CSz7HH/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-CSz7HH/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
