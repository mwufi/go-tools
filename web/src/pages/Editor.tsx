import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { useSession } from "../store";
import { navigate, useLocation } from "../router";
import { Arrow, errText } from "../ui";

type Initial = Partial<Pick<Doc<"links">, "keyword" | "url" | "description" | "emptyUrl" | "scope" | "scopeId" | "_id">>;

export function LinkForm({ initial, onDone }: { initial: Initial; onDone?: (keyword: string) => void }) {
  const session = useSession()!;
  const me = useQuery(api.users.me, { token: session.apiToken });
  const save = useMutation(api.links.save);
  const [keyword, setKeyword] = useState(initial.keyword ?? "");
  const [url, setUrl] = useState(initial.url ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [emptyUrl, setEmptyUrl] = useState(initial.emptyUrl ?? "");
  const [scope, setScope] = useState<string>(initial.scope === "team" ? initial.scopeId! : "user");
  const [more, setMore] = useState(!!initial.emptyUrl);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const hasArgs = /\{(\*|\d+)\}|%s/.test(url);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await save({
        token: session.apiToken,
        scope: scope === "user" ? "user" : { teamId: scope as Id<"teams"> },
        keyword,
        url,
        description,
        emptyUrl: emptyUrl || undefined,
        previousId: initial._id,
      });
      const k = keyword.trim().toLowerCase().replace(/\s+/g, " ").replace(/^go\//, "");
      onDone ? onDone(k) : navigate(`/i/${encodeURIComponent(k)}`, true);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={submit} style={{ gap: 26 }}>
      <label className="kw-hero">
        <span className="go">go/</span>
        <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="keyword" autoFocus={!initial.keyword} spellCheck={false} autoComplete="off" aria-label="Keyword" />
      </label>
      <label className="field">
        <span>Goes to</span>
        <input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required autoFocus={!!initial.keyword && !initial.url} spellCheck={false} />
        <span className="hint">
          Placeholders: <code>{"{*}"}</code> everything typed after the keyword, <code>{"{1}"}</code> <code>{"{2}"}</code> single words, <code>{"{me.github}"}</code> your variables, <code>{"{team.github_org}"}</code> the team's.
        </span>
      </label>
      <label className="field">
        <span>What it's for</span>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shows up in search and helps the model pick it" maxLength={200} />
      </label>
      {(more || hasArgs) && (
        <label className="field">
          <span>When nothing follows the keyword, go to</span>
          <input className="input mono" value={emptyUrl} onChange={(e) => setEmptyUrl(e.target.value)} placeholder="optional, e.g. the site's home page" spellCheck={false} />
        </label>
      )}
      <div className="field">
        <span>Who it's for</span>
        <div className="seg" style={{ justifySelf: "start" }}>
          <button type="button" className={scope === "user" ? "on" : ""} onClick={() => setScope("user")}>Just me</button>
          {me?.teams.map((t) => (
            <button type="button" key={t._id} className={scope === t._id ? "on" : ""} onClick={() => setScope(t._id)}>{t.name}</button>
          ))}
        </div>
        {me && me.teams.length === 0 && <span className="hint">Join or create a team in Settings to share shortcuts.</span>}
      </div>
      {err && <div className="error">{err}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn primary" disabled={busy}>{initial._id ? "Save changes" : "Create shortcut"} <Arrow /></button>
        {!more && !hasArgs && <button type="button" className="btn ghost" onClick={() => setMore(true)}>More options</button>}
      </div>
    </form>
  );
}

export function Editor() {
  const { params } = useLocation();
  return (
    <div className="fade-in" style={{ marginTop: 48, maxWidth: 680 }}>
      <div className="eyebrow" style={{ marginBottom: 20 }}>New shortcut</div>
      <LinkForm initial={{ keyword: params.get("k") ?? "", url: params.get("u") ?? "", description: params.get("d") ?? "" }} />
    </div>
  );
}
