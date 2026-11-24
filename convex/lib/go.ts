// Pure helpers shared by the resolver, the API and tests. No Convex imports.

export const MAX_KEYWORD_WORDS = 3;
export const RESERVED = new Set(["go", "s", "api", "mcp", "think", "new", "i", "settings", "welcome"]);

export const SEARCH_ENGINES: Record<string, { name: string; url: string }> = {
  google: { name: "Google", url: "https://www.google.com/search?q={*}" },
  kagi: { name: "Kagi", url: "https://kagi.com/search?q={*}" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q={*}" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q={*}" },
  perplexity: { name: "Perplexity", url: "https://www.perplexity.ai/search?q={*}" },
};

export function normalizeKeyword(raw: string): string {
  return raw.trim().toLowerCase().replace(/^go\//, "").replace(/\s+/g, " ");
}

export function validateKeyword(raw: string): string {
  const k = normalizeKeyword(raw);
  if (!k) throw new Error("Keyword is empty");
  const words = k.split(" ");
  if (words.length > MAX_KEYWORD_WORDS) throw new Error(`Keywords are at most ${MAX_KEYWORD_WORDS} words`);
  if (words.some((w) => !/^[\p{L}\p{N}][\p{L}\p{N}._\-]*$/u.test(w)))
    throw new Error("Keywords use letters, numbers, dots, dashes and underscores");
  if (k.length > 60) throw new Error("Keyword is too long");
  if (RESERVED.has(k)) throw new Error(`"${k}" is reserved`);
  return k;
}

export function validateUrl(raw: string): string {
  const u = raw.trim();
  // Templates may contain {..} placeholders, which URL() would reject in the host.
  const probe = u.replace(/\{[^}]*\}/g, "x").replace(/%s/g, "x");
  let parsed: URL;
  try {
    parsed = new URL(probe);
  } catch {
    throw new Error("That doesn't look like a URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Use an http(s) URL");
  return u;
}

export type Parsed =
  | { kind: "home" }
  | { kind: "info"; keyword: string }
  | {
      kind: "query";
      raw: string; // query with go/ prefix and sigils stripped
      words: string[]; // original-case words
      lower: string[];
      explicit: boolean; // typed go/ or "go "
      askLlm: boolean; // ? prefix or ! suffix
    };

export function parseQuery(input: string): Parsed {
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

/** Candidate keywords, longest first: "my prs x" -> ["my prs x", "my prs", "my"]. */
export function candidates(lower: string[]): { keyword: string; n: number }[] {
  const out = [];
  for (let n = Math.min(MAX_KEYWORD_WORDS, lower.length); n >= 1; n--) {
    out.push({ keyword: lower.slice(0, n).join(" "), n });
  }
  return out;
}

export type Vars = { me: Record<string, string>; team: Record<string, string> };

/**
 * Fill a URL template. Returns null when the template needs arguments that
 * were not given (the caller then uses emptyUrl or the info page).
 */
export function fillTemplate(template: string, args: string[], vars: Vars): string | null {
  const rest = args.join(" ");
  let missing = false;
  const queryStart = template.indexOf("?") === -1 ? Infinity : template.indexOf("?");
  // In the path, keep "/" so `gh owner/repo` works; in the query string, encode everything.
  const enc = (s: string, at: number) =>
    at < queryStart ? encodeURIComponent(s).replace(/%2F/gi, "/") : encodeURIComponent(s);
  const out = template.replace(/\{([^}]+)\}|%s/g, (whole, name: string | undefined, at: number) => {
    if (whole === "%s" || name === "*") {
      if (!rest) missing = true;
      return enc(rest, at);
    }
    if (/^\d+$/.test(name!)) {
      const a = args[Number(name) - 1];
      if (a === undefined) missing = true;
      return enc(a ?? "", at);
    }
    const [ns, key] = name!.split(".", 2);
    if ((ns === "me" || ns === "team") && key) {
      const val = vars[ns][key];
      if (val === undefined) missing = true;
      return encodeURIComponent(val ?? "");
    }
    return whole; // unknown placeholder: leave as is
  });
  return missing ? null : out;
}

/**
 * How many trailing words a template can absorb: Infinity for {*} or %s,
 * otherwise the highest {n} it uses (0 for a plain URL).
 */
export function maxArgs(template: string): number {
  if (/\{\*\}|%s/.test(template)) return Infinity;
  let max = 0;
  for (const m of template.matchAll(/\{(\d+)\}/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * Whether a shortcut should handle a query with these extra words. Extra words
 * a template has no slot for ("convex components" against a plain go/convex)
 * mean the person is searching, not using the shortcut.
 */
export function argsFit(template: string, args: string[]): boolean {
  return args.length <= maxArgs(template);
}

export function needsArgs(template: string): boolean {
  return /\{(\*|\d+)\}|%s/.test(template);
}

export function searchUrl(fallback: string, q: string): string {
  const t = SEARCH_ENGINES[fallback]?.url ?? (fallback.includes("{*}") ? fallback : SEARCH_ENGINES.google.url);
  return t.replace("{*}", encodeURIComponent(q));
}

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}
