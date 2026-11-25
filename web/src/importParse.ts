// Turn a bookmarks export or a CSV into shortcuts to review. Pure (no DOM), so it's testable.

export type ImportRow = { keyword: string; url: string; description: string };

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const STOP = new Set(["the", "a", "an", "and", "of", "for", "to", "in", "on", "my", "your", "home", "page", "welcome", "dashboard"]);

/** A short keyword from a page title or host: "Linear – Issues" -> "linear". */
export function keywordFrom(title: string, url: string): string {
  const words = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w) && w.length <= 20);
  if (words.length) return words.slice(0, words[0].length <= 3 && words[1] ? 2 : 1).join("-");
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").split(".");
    return host.length > 1 ? host[host.length - 2] : host[0];
  } catch {
    return "";
  }
}

/** Netscape bookmark HTML (what Chrome, Firefox, Safari and Arc export). Firefox keywords (SHORTCUTURL) are kept. */
export function parseBookmarksHtml(html: string): ImportRow[] {
  const out: ImportRow[] = [];
  const re = /<a\s([^>]*)>([\s\S]*?)<\/a>/gi;
  for (let m; (m = re.exec(html)); ) {
    const attrs = m[1];
    const href = /href\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    if (!href || !/^https?:/i.test(href)) continue;
    const url = decode(href);
    const title = decode(m[2].replace(/<[^>]+>/g, "")).trim();
    const kw = /shortcuturl\s*=\s*"([^"]*)"/i.exec(attrs)?.[1];
    out.push({ keyword: kw ? decode(kw).toLowerCase() : keywordFrom(title, url), url, description: title.slice(0, 200) });
  }
  return out;
}

function splitCsvLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) cells.push(cur), (cur = "");
    else cur += c;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/** CSV or TSV: keyword, url, description (in any column order if there's a header naming them). */
export function parseCsv(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",";
  let cols = { keyword: 0, url: 1, description: 2 };
  const head = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase());
  const isUrl = (s: string) => /^https?:\/\//i.test(s);
  if (!head.some(isUrl)) {
    const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
    const k = find("keyword", "shortcut", "name", "key", "alias", "short");
    const u = find("url", "link", "destination", "target", "href", "long url");
    const d = find("description", "desc", "title", "notes");
    if (k >= 0 && u >= 0) cols = { keyword: k, url: u, description: d };
    lines.shift();
  }
  return lines
    .map((l) => splitCsvLine(l, sep))
    .filter((c) => isUrl(c[cols.url] ?? ""))
    .map((c) => ({
      keyword: (c[cols.keyword] ?? "").toLowerCase().replace(/^go\//, ""),
      url: c[cols.url],
      description: cols.description >= 0 ? (c[cols.description] ?? "").slice(0, 200) : "",
    }));
}

/** Detect the format and parse. Duplicate keywords get -2, -3… so nothing is silently dropped. */
export function parseImport(text: string): ImportRow[] {
  const rows = /<a\s[^>]*href/i.test(text) ? parseBookmarksHtml(text) : parseCsv(text);
  const used = new Map<string, number>();
  const seenUrl = new Set<string>();
  const out: ImportRow[] = [];
  for (const r of rows) {
    if (seenUrl.has(r.url)) continue;
    seenUrl.add(r.url);
    let k = r.keyword.trim().replace(/\s+/g, " ") || "link";
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    if (n) k = `${k}-${n + 1}`;
    out.push({ ...r, keyword: k });
  }
  return out;
}
