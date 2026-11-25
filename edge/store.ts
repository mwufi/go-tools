// Where an edge keeps its copy of the shortcuts. The Worker uses D1
// (worker/src/d1.ts); Cloud Run keeps it in memory (MemoryStore below).
import type { LinkLite, Source } from "../convex/lib/core";
import { didYouMean } from "../convex/lib/fuzzy";
import type { Change, Dump, EdgeLearned, EdgeTeam, EdgeToken, EdgeUser } from "../convex/lib/edgeRows";

/** "empty" = never synced; "unknown-token" = a token we don't have. */
export type Lookup = { src: Source; llm: boolean } | "empty" | "unknown-token";

export interface Store {
  seq(): Promise<number>;
  apply(changes: Change[], seq: number, llm: boolean): Promise<void>;
  replace(d: Dump): Promise<void>;
  /** Everything needed to resolve one query: the user, links matching these keywords, team vars, a kept LLM answer. */
  lookup(tokenHash: string | null, keywords: string[], queryNorm: string | null): Promise<Lookup>;
  suggest(tokenHash: string | null, prefix: string): Promise<string[]>;
}

export function sourceFrom(user: EdgeUser | null, links: LinkLite[], teams: EdgeTeam[], learnedUrl: string | null): Source {
  const byKey = new Map(links.map((l) => [`${l.scopeId}\u0000${l.keyword}`, l]));
  const vars = new Map(teams.map((t) => [t.id, t.vars]));
  return {
    user: user && { id: user.id, vars: user.vars, fallbackSearch: user.fallbackSearch, llmEnabled: user.llmEnabled, llmMy: user.llmMy, primaryTeamId: user.primaryTeamId },
    scopes: user ? [user.id, ...user.teamIds, "global"] : ["global"],
    teamVars: (id) => vars.get(id) ?? {},
    link: (scopeId, keyword) => byKey.get(`${scopeId}\u0000${keyword}`) ?? null,
    learned: () => learnedUrl,
  };
}

export class MemoryStore implements Store {
  private s = 0;
  private llm = false;
  private links = new Map<string, LinkLite>();
  private byKey = new Map<string, LinkLite>();
  private users = new Map<string, EdgeUser>();
  private tokens = new Map<string, EdgeToken>();
  private byHash = new Map<string, EdgeToken>();
  private teams = new Map<string, EdgeTeam>();
  private learned = new Map<string, EdgeLearned>();

  async seq() { return this.s; }

  private put(c: Change) {
    if (c.table === "links") {
      const old = this.links.get(c.id);
      if (old) this.byKey.delete(`${old.scopeId}\u0000${old.keyword}`);
      if (c.row) { this.links.set(c.id, c.row); this.byKey.set(`${c.row.scopeId}\u0000${c.row.keyword}`, c.row); } else this.links.delete(c.id);
    } else if (c.table === "tokens") {
      const old = this.tokens.get(c.id);
      if (old) this.byHash.delete(old.hash);
      if (c.row) { this.tokens.set(c.id, c.row); this.byHash.set(c.row.hash, c.row); } else this.tokens.delete(c.id);
    } else {
      const m = this[c.table] as Map<string, unknown>;
      if (c.row) m.set(c.id, c.row); else m.delete(c.id);
    }
  }

  async apply(changes: Change[], seq: number, llm: boolean) {
    for (const c of changes) this.put(c);
    this.s = seq;
    this.llm = llm;
  }

  async replace(d: Dump) {
    for (const m of [this.links, this.byKey, this.users, this.tokens, this.byHash, this.teams, this.learned]) m.clear();
    for (const row of d.links) this.put({ seq: 0, table: "links", id: row.id, row });
    for (const row of d.users) this.put({ seq: 0, table: "users", id: row.id, row });
    for (const row of d.tokens) this.put({ seq: 0, table: "tokens", id: row.id, row });
    for (const row of d.teams) this.put({ seq: 0, table: "teams", id: row.id, row });
    for (const row of d.learned) this.put({ seq: 0, table: "learned", id: row.id, row });
    this.s = d.seq;
    this.llm = d.llm;
  }

  private userFor(tokenHash: string | null): EdgeUser | null | undefined {
    if (!tokenHash) return null;
    const t = this.byHash.get(tokenHash);
    return t ? this.users.get(t.userId) : undefined;
  }

  async lookup(tokenHash: string | null, _keywords: string[], queryNorm: string | null): Promise<Lookup> {
    if (this.s === 0) return "empty";
    const user = this.userFor(tokenHash);
    if (user === undefined) return "unknown-token";
    let learned: EdgeLearned | null = null;
    if (user && queryNorm)
      for (const r of this.learned.values()) if (r.userId === user.id && r.queryNorm === queryNorm && (!learned || r.at > learned.at)) learned = r;
    const teams = (user?.teamIds ?? []).map((id) => this.teams.get(id)).filter((t): t is EdgeTeam => !!t);
    const src = sourceFrom(user, [], teams, learned?.url ?? null);
    src.link = (scopeId, keyword) => this.byKey.get(`${scopeId}\u0000${keyword}`) ?? null;
    return { src, llm: this.llm };
  }

  async suggest(tokenHash: string | null, prefix: string) {
    const user = this.userFor(tokenHash) ?? null;
    const scopes = new Set(user ? [user.id, ...user.teamIds, "global"] : ["global"]);
    const out = new Set<string>();
    const all = new Set<string>();
    for (const l of this.links.values()) if (scopes.has(l.scopeId)) all.add(l.keyword);
    for (const k of all) if (k.startsWith(prefix)) out.add(k);
    if (!out.size) return didYouMean(prefix, all); // "revews" -> reviews
    return [...out].sort().slice(0, 8);
  }
}
