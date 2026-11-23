// D1-backed store for the Worker. Every isolate in every Cloudflare location
// reads the same database, so one push from Convex updates all of them.
// The tables create themselves on first sync; no migration step.
import type { LinkLite } from "../../convex/lib/core";
import type { Change, Dump, EdgeTable, EdgeTeam, EdgeUser } from "../../convex/lib/edgeRows";
import { sourceFrom, type Lookup, type Store } from "../../edge/store";

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, scope_id TEXT NOT NULL, keyword TEXT NOT NULL, row TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS links_by_keyword ON links (keyword, scope_id)",
  "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, row TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, hash TEXT NOT NULL, user_id TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS tokens_by_hash ON tokens (hash)",
  "CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, row TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS learned (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, query_norm TEXT NOT NULL, at REAL NOT NULL, url TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS learned_by_query ON learned (user_id, query_norm, at)",
];

// The signed-in user's scopes, as SQL: their own id plus their team ids. ?1 = token hash.
const USER = "(SELECT u.row FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.hash = ?1)";
const TEAM_IDS = `(SELECT value FROM json_each(json_extract(${USER}, '$.teamIds')))`;
const IN_SCOPE = `(scope_id = 'global' OR scope_id = json_extract(${USER}, '$.id') OR scope_id IN ${TEAM_IDS})`;

const CHUNK = 200;

export class D1Store implements Store {
  private ready = false;
  constructor(private db: D1Database) {}

  private async init() {
    if (this.ready) return;
    await this.db.batch(SCHEMA.map((s) => this.db.prepare(s)));
    this.ready = true;
  }

  async seq() {
    try {
      const r = await this.db.prepare("SELECT v FROM meta WHERE k = 'seq'").first<{ v: string }>();
      return r ? Number(r.v) : 0;
    } catch {
      return 0; // tables not created yet
    }
  }

  private write(table: EdgeTable, id: string, row: unknown): D1PreparedStatement {
    if (row === null) return this.db.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id);
    switch (table) {
      case "links": {
        const l = row as LinkLite;
        return this.db.prepare("INSERT OR REPLACE INTO links VALUES (?1, ?2, ?3, ?4)").bind(id, l.scopeId, l.keyword, JSON.stringify(l));
      }
      case "tokens": {
        const t = row as { hash: string; userId: string };
        return this.db.prepare("INSERT OR REPLACE INTO tokens VALUES (?1, ?2, ?3)").bind(id, t.hash, t.userId);
      }
      case "learned": {
        const r = row as { userId: string; queryNorm: string; at: number; url: string };
        return this.db.prepare("INSERT OR REPLACE INTO learned VALUES (?1, ?2, ?3, ?4, ?5)").bind(id, r.userId, r.queryNorm, r.at, r.url);
      }
      default:
        return this.db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (?1, ?2)`).bind(id, JSON.stringify(row));
    }
  }

  private meta(seq: number, llm: boolean) {
    return [
      this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('seq', ?1)").bind(String(seq)),
      this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('llm', ?1)").bind(llm ? "1" : "0"),
    ];
  }

  async apply(changes: Change[], seq: number, llm: boolean) {
    await this.init();
    // One batch = one transaction, so readers never see half a page.
    await this.db.batch([...changes.map((c) => this.write(c.table, c.id, c.row)), ...this.meta(seq, llm)]);
  }

  async replace(d: Dump) {
    await this.init();
    const stmts: D1PreparedStatement[] = [
      this.db.prepare("DELETE FROM meta WHERE k = 'seq'"),
      ...(["links", "users", "tokens", "teams", "learned"] as const).map((t) => this.db.prepare(`DELETE FROM ${t}`)),
    ];
    for (const table of ["links", "users", "tokens", "teams", "learned"] as const)
      for (const row of d[table]) stmts.push(this.write(table, row.id, row));
    for (let i = 0; i < stmts.length; i += CHUNK) await this.db.batch(stmts.slice(i, i + CHUNK));
    await this.db.batch(this.meta(d.seq, d.llm)); // last, so an interrupted replace starts over
  }

  async lookup(tokenHash: string | null, keywords: string[], queryNorm: string | null): Promise<Lookup> {
    const h = tokenHash ?? "";
    const kws = keywords.length ? keywords : [""];
    const ph = kws.map((_, i) => `?${i + 2}`).join(", ");
    let res: D1Result[];
    try {
      // One round trip: meta, user, matching links, team vars, kept LLM answer.
      res = await this.db.batch([
        this.db.prepare("SELECT k, v FROM meta"),
        this.db.prepare(`SELECT ${USER} AS row`).bind(h),
        this.db.prepare(`SELECT row FROM links WHERE keyword IN (${ph}) AND ${IN_SCOPE}`).bind(h, ...kws),
        this.db.prepare(`SELECT row FROM teams WHERE id IN ${TEAM_IDS}`).bind(h),
        this.db
          .prepare(`SELECT url FROM learned WHERE user_id = json_extract(${USER}, '$.id') AND query_norm = ?2 ORDER BY at DESC LIMIT 1`)
          .bind(h, queryNorm ?? ""),
      ]);
    } catch {
      return "empty"; // tables not created yet
    }
    const meta = new Map((res[0].results as { k: string; v: string }[]).map((r) => [r.k, r.v]));
    if (!meta.get("seq")) return "empty";
    const userJson = (res[1].results[0] as { row: string | null } | undefined)?.row ?? null;
    if (tokenHash && !userJson) return "unknown-token";
    const user = userJson ? (JSON.parse(userJson) as EdgeUser) : null;
    const links = (res[2].results as { row: string }[]).map((r) => JSON.parse(r.row) as LinkLite);
    const teams = (res[3].results as { row: string }[]).map((r) => JSON.parse(r.row) as EdgeTeam);
    const learned = (res[4].results[0] as { url: string } | undefined)?.url ?? null;
    return { src: sourceFrom(user, links, teams, learned), llm: meta.get("llm") === "1" };
  }

  async suggest(tokenHash: string | null, prefix: string) {
    const r = await this.db
      .prepare(`SELECT DISTINCT keyword FROM links WHERE keyword >= ?2 AND keyword < ?3 AND ${IN_SCOPE} ORDER BY keyword LIMIT 8`)
      .bind(tokenHash ?? "", prefix, prefix + "￿")
      .all<{ keyword: string }>();
    return r.results.map((x) => x.keyword);
  }
}
