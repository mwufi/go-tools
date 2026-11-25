import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSession } from "../store";
import { CopyField, errText } from "../ui";
import { parseImport, type ImportRow } from "../importParse";
import { normalizeKeyword } from "../../../convex/lib/go";

/** Make a one-time code / link that signs you in somewhere else. */
export function OtherDevice() {
  const session = useSession()!;
  const create = useAction(api.users.createLoginCode);
  const [made, setMade] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!made) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [made]);
  const left = made ? Math.max(0, Math.round((made.expiresAt - now) / 1000)) : 0;
  return (
    <div>
      <button className="btn small" onClick={async () => setMade(await create({ token: session.apiToken }))}>{made ? "Make a new code" : "Get a sign-in link"}</button>
      {made && left > 0 && (
        <div style={{ marginTop: 14 }}>
          <CopyField value={`${location.origin}/?login=${made.code}`} label="Copy link" />
          <p className="hint">
            Open it on the other device, or type <code>{made.code}</code> under “I have a code”. Works once, for the next {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}. That device gets its own tokens, which you can revoke below.
          </p>
        </div>
      )}
      {made && left === 0 && <p className="hint">That code expired. Make a new one.</p>}
    </div>
  );
}

/** Paste or upload bookmarks / a CSV, review, then add them in one go. */
export function Importer() {
  const session = useSession()!;
  const me = useQuery(api.users.me, { token: session.apiToken });
  const importMany = useMutation(api.links.importMany);
  const [rows, setRows] = useState<(ImportRow & { on: boolean })[] | null>(null);
  const [text, setText] = useState("");
  const [scope, setScope] = useState<string>("user");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [err, setErr] = useState("");

  const load = (t: string) => {
    setErr("");
    setResult("");
    const parsed = parseImport(t);
    if (!parsed.length) return setErr("Didn't find any links. Use a bookmarks export (.html) or lines of keyword,url,description.");
    setRows(parsed.map((r) => ({ ...r, on: true })));
  };

  const chosen = rows?.filter((r) => r.on) ?? [];
  return (
    <div className="form-grid">
      {!rows ? (
        <>
          <label className="btn small" style={{ justifySelf: "start", cursor: "pointer" }}>
            Choose a file
            <input type="file" accept=".html,.htm,.csv,.tsv,.txt" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await f.text()); }} />
          </label>
          <textarea className="input mono" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={"or paste lines like\nwiki,https://wiki.acme.dev,Team wiki"} style={{ height: "auto", padding: 10 }} />
          <button className="btn small" style={{ justifySelf: "start" }} disabled={!text.trim()} onClick={() => load(text)}>Review</button>
          <p className="hint" style={{ margin: 0 }}>
            Chrome, Arc and Brave: Bookmarks → Bookmark manager → ⋮ → Export bookmarks. Firefox: Bookmarks → Manage → Import and Backup → Export to HTML (your bookmark keywords come along). A CSV from another go-links tool works too.
          </p>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>{chosen.length} of {rows.length} selected</span>
            {chosen.length > 300 && <span className="hint">300 at a time, please</span>}
            <button className="btn small ghost" onClick={() => setRows(rows.map((r) => ({ ...r, on: !chosen.length })))}>{chosen.length ? "Select none" : "Select all"}</button>
            <span style={{ flex: 1 }} />
            <div className="seg">
              <button className={scope === "user" ? "on" : ""} onClick={() => setScope("user")}>Just me</button>
              {me?.teams.map((t) => <button key={t._id} className={scope === t._id ? "on" : ""} onClick={() => setScope(t._id)}>{t.name}</button>)}
            </div>
          </div>
          <div style={{ maxHeight: 380, overflow: "auto" }}>
            <table className="import-table">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ opacity: r.on ? 1 : 0.45 }}>
                    <td style={{ width: 24 }}><input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} aria-label={`Import ${r.keyword}`} /></td>
                    <td style={{ width: "28%" }}><input type="text" className="input mono" style={{ height: 30 }} value={r.keyword} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, keyword: e.target.value } : x)))} aria-label="Keyword" /></td>
                    <td><div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 260 }}>{r.description}</div><div className="u" title={r.url}>{r.url}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn small primary" disabled={busy || !chosen.length || chosen.length > 300} title={chosen.length > 300 ? "Pick 300 or fewer at a time" : undefined} onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                const r = await importMany({
                  token: session.apiToken,
                  scope: scope === "user" ? "user" : { teamId: scope as Id<"teams"> },
                  items: chosen.map(({ keyword, url, description }) => ({ keyword, url, description })),
                });
                // Keep what was skipped (so a clash can be renamed and retried) and what wasn't picked.
                const skipped = new Set(r.skipped.map((s) => s.keyword));
                const wasSkipped = (x: ImportRow) => skipped.has(x.keyword) || skipped.has(normalizeKeyword(x.keyword));
                const left = rows.filter((x) => !x.on || wasSkipped(x)).map((x) => ({ ...x, on: x.on && wasSkipped(x) }));
                setResult(`Added ${r.created}.` + (r.skipped.length ? ` Skipped ${r.skipped.length}: ${r.skipped.slice(0, 4).map((s) => `${s.keyword} (${s.reason})`).join(", ")}${r.skipped.length > 4 ? "…" : ""}` : ""));
                setRows(left.length ? left : null);
                setText("");
              } catch (e) {
                setErr(errText(e));
              } finally {
                setBusy(false);
              }
            }}>Add {chosen.length} shortcut{chosen.length === 1 ? "" : "s"}</button>
            <button className="btn small ghost" onClick={() => setRows(null)}>Start over</button>
          </div>
        </>
      )}
      {result && <p className="hint" style={{ margin: 0, color: "var(--good)" }}>{result}</p>}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

/** On/off for keeping missed searches (and so for "worth a shortcut" suggestions). */
export function MissTracking({ Toggle }: { Toggle: (p: { checked: boolean; onChange: (v: boolean) => void; title: string; children: React.ReactNode }) => React.ReactNode }) {
  const session = useSession()!;
  const act = useQuery(api.activity.mine, { token: session.apiToken });
  const set = useMutation(api.activity.setTracking);
  if (!act) return null;
  return (
    <Toggle checked={act.trackMisses} onChange={(on) => set({ token: session.apiToken, on })} title="Suggest shortcuts from my searches">
      Keeps one- and two-word searches that found no shortcut for 30 days, so the home page can suggest making one. Only you see them; your team only sees a keyword when two or more of you tried it, as a count. Turning this off forgets them.
    </Toggle>
  );
}
