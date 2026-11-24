// What a search reports back to Convex, decided where the search is answered
// (the Convex /s action or an edge). Pure: no Convex imports.
//
// Reports are off the hot path on the edge (sent after the redirect) and
// cheap on Convex, but there can be many, so we only send:
//  - every miss that looks like someone reaching for a shortcut,
//  - 1 in 10 shortcut hits (counted as 10, like click counts),
//  - the first search we see from a token each day (so the welcome page can
//    tell setup worked and "days active" stays right).
// (Self-contained on purpose: tests load it without a bundler.)

export type ResultKind = "redirect" | "search" | "think" | "create" | "info" | "home";

export type Report = {
  kind: ResultKind;
  /** Normalized query when it missed and looks like a shortcut someone wanted. */
  miss: string | null;
  /** How many hits this report stands for (0 for a miss or a plain check-in). */
  hits: number;
};

/**
 * A query that went to web search (or the create page) and could have been a
 * shortcut: at most two words, not a plain-words question. "standup" and
 * "go/oncall" count; "best ramen near soma" doesn't.
 */
export function missKeyword(q: string, kind: ResultKind): string | null {
  if (kind !== "search" && kind !== "create") return null;
  // Same prefixes and sigils as parseQuery in go.ts: "go/x" counts, "? x" and "x!" are questions.
  const raw = q.trim().replace(/^go(\/|\s+)/i, "").trim();
  if (!raw || raw.startsWith("?") || raw.endsWith("!") || raw.endsWith("+")) return null;
  const k = raw.toLowerCase().replace(/\s+/g, " ");
  if (k.split(" ").length > 2) return null;
  if (k.length > 40 || !/^[\p{L}\p{N}][\p{L}\p{N}._\- ]*$/u.test(k)) return null;
  return k;
}

const seenToday = new Map<string, string>(); // tokenHash -> UTC day last reported from this instance

export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Decide whether this search is worth a report, and what it says. null = don't report. */
export function reportFor(tokenHash: string | null, q: string, kind: ResultKind, hasLink: boolean, now = Date.now(), rand = Math.random()): Report | null {
  if (!tokenHash) return null;
  const miss = missKeyword(q, kind);
  const hits = hasLink && rand < 0.1 ? 10 : 0;
  const day = dayOf(now);
  const firstToday = seenToday.get(tokenHash) !== day;
  if (!miss && !hits && !firstToday) return null;
  if (seenToday.size > 5000) seenToday.clear();
  seenToday.set(tokenHash, day);
  return { kind, miss, hits };
}

/** For tests. */
export function _resetSeen() {
  seenToday.clear();
}
