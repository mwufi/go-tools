import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LLM_AVAILABLE, SEARCH_BASE } from "../config";
import { useSession } from "../store";
import { linkProps } from "../router";
import { Arrow, IllusSignpost, ScopeChip, hostOf } from "../ui";

const RANK: Record<string, number> = { user: 0, team: 1, global: 2 };

function CommandBar() {
  const session = useSession()!;
  const [q, setQ] = useState("");
  const r = useQuery(api.resolve.preview, q.trim() ? { token: session.apiToken, q, llmAvailable: LLM_AVAILABLE } : "skip");
  const go = () => {
    if (!q.trim()) return;
    const t = session.searchToken ?? session.apiToken;
    location.href = `${SEARCH_BASE}/s?q=${encodeURIComponent(q)}&t=${encodeURIComponent(t)}`;
  };
  let dest: React.ReactNode = <span className="faint">Try <code>my prs</code>, <code>gh owner/repo</code>, or <code>? anything in plain words</code></span>;
  if (q.trim() && r) {
    if (r.kind === "redirect")
      dest = (
        <>
          <Arrow />
          <span className="url">{r.url}</span>
          <span className="chip" style={{ flex: "none" }}>{r.via === "learned" ? "saved answer" : `go/${r.keyword}`}</span>
        </>
      );
    else if (r.kind === "search") dest = (<><Arrow /><span>Web search</span><span className="url faint">{hostOf(r.url).split("/")[0]}</span></>);
    else if (r.kind === "think") dest = (<><Arrow /><span>Ask the model where <i>“{r.q}”</i> should go</span></>);
    else if (r.kind === "create") dest = (<><Arrow /><span>No <code>go/{r.keyword}</code> yet: create it</span></>);
    else if (r.kind === "info") dest = (<><Arrow /><span><code>go/{r.keyword}</code> needs more words after it</span></>);
  }
  return (
    <div className="fade-in d1">
      <form className="command" onSubmit={(e) => (e.preventDefault(), go())}>
        <span className="prefix">go/</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="where to?" autoFocus spellCheck={false} autoComplete="off" aria-label="Query" />
        <span className="kbd">↵</span>
      </form>
      <div className="dest">{dest}</div>
    </div>
  );
}

export function Home() {
  const session = useSession()!;
  const links = useQuery(api.links.list, { token: session.apiToken });
  const me = useQuery(api.users.me, { token: session.apiToken });
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    if (!links) return [];
    const seen = new Set<string>();
    const all = links.map((l) => {
      const shadowed = seen.has(l.keyword);
      seen.add(l.keyword);
      return { ...l, shadowed };
    });
    const s = search.trim().toLowerCase();
    return all
      .filter((l) => filter === "all" || (filter === "user" ? l.scope === "user" : filter === "global" ? l.scope === "global" : l.scopeId === filter))
      .filter((l) => !s || l.keyword.includes(s) || l.description.toLowerCase().includes(s) || l.url.toLowerCase().includes(s))
      .sort((a, b) => RANK[a.scope] - RANK[b.scope] || b.clicks - a.clicks || a.keyword.localeCompare(b.keyword));
  }, [links, filter, search]);

  const mine = links?.filter((l) => l.scope === "user").length ?? 0;

  return (
    <div style={{ marginTop: 40 }}>
      <h1 className="title fade-in" style={{ marginBottom: 28 }}>Where <em>to</em>?</h1>
      <CommandBar />

      <div className="toolbar">
        <div className="seg">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All</button>
          <button className={filter === "user" ? "on" : ""} onClick={() => setFilter("user")}>Mine</button>
          {me?.teams.map((t) => (
            <button key={t._id} className={filter === t._id ? "on" : ""} onClick={() => setFilter(t._id)}>{t.name}</button>
          ))}
          <button className={filter === "global" ? "on" : ""} onClick={() => setFilter("global")}>Built-in</button>
        </div>
        <div className="spacer" />
        <input className="input search-mini" placeholder="Filter" value={search} onChange={(e) => setSearch(e.target.value)} />
        <a className="btn primary small" {...linkProps("/new")}>New shortcut</a>
      </div>

      {links && filter === "user" && mine === 0 ? (
        <div className="empty fade-in">
          <IllusSignpost />
          <div className="serif" style={{ fontSize: 26, color: "var(--ink)" }}>No shortcuts of your own yet</div>
          <p style={{ margin: 0, maxWidth: 380 }}>Type <code>go/anything</code> in your address bar to make one, or start here.</p>
          <a className="btn" {...linkProps("/new")}>New shortcut</a>
        </div>
      ) : (
        <div className="rows">
          {rows.map((l, i) => (
            <a key={l._id} className="row" style={{ animationDelay: `${Math.min(i, 12) * 25}ms`, opacity: l.shadowed ? 0.45 : 1 }} {...linkProps(`/i/${encodeURIComponent(l.keyword)}`)}>
              <div className="kw"><span className="go">go/</span><span className="word">{l.keyword}</span></div>
              <div className="mid">
                <div className="desc">{l.description || <span className="faint">{hostOf(l.url)}</span>}</div>
                <div className="url">{l.url}</div>
              </div>
              <div className="meta">
                {l.shadowed && <span title="A shortcut closer to you uses this keyword">overridden</span>}
                {l.clicks > 0 && <span className="mono">{l.clicks}×</span>}
                <ScopeChip scope={l.scope} name={l.scopeName} />
              </div>
            </a>
          ))}
          {links && rows.length === 0 && <div className="empty"><span>Nothing matches.</span></div>}
        </div>
      )}
    </div>
  );
}
