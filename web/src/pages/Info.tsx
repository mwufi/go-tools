import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSession } from "../store";
import { linkProps, navigate } from "../router";
import { IllusSignpost, ScopeChip, errText, useToast } from "../ui";
import { LinkForm } from "./Editor";

function ago(ms: number) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function Info({ keyword }: { keyword: string }) {
  const session = useSession()!;
  const data = useQuery(api.links.info, { token: session.apiToken, keyword });
  const remove = useMutation(api.links.remove);
  const revert = useMutation(api.links.revert);
  const [editing, setEditing] = useState<Id<"links"> | null>(null);
  const [toast, say] = useToast();

  if (!data) return null;
  const [winner, ...others] = data.links;

  if (!winner)
    return (
      <div className="empty fade-in" style={{ paddingTop: 96 }}>
        <IllusSignpost />
        <h1 className="title"><span className="mono" style={{ fontSize: 36 }}>go/{keyword}</span> isn't taken</h1>
        <a className="btn primary" {...linkProps(`/new?k=${encodeURIComponent(keyword)}`)}>Create it</a>
      </div>
    );

  return (
    <div className="fade-in" style={{ marginTop: 48 }}>
      <div className="eyebrow">Shortcut</div>
      <h1 style={{ font: "500 48px var(--mono)", letterSpacing: "-0.03em", margin: "14px 0 30px", wordBreak: "break-word" }}>
        <span className="faint">go/</span>{data.keyword}
      </h1>

      {data.links.map((l, i) => (
        <div key={l._id} className="card" style={{ marginBottom: 14, opacity: i === 0 ? 1 : 0.7 }}>
          {editing === l._id ? (
            <LinkForm initial={l} onDone={(k) => (setEditing(null), k !== keyword && navigate(`/i/${encodeURIComponent(k)}`, true), say("Saved"))} />
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <ScopeChip scope={l.scope} name={l.scopeName} />
                {i === 0 && others.length > 0 && <span className="hint">wins over {others.map((o) => o.scopeName).join(", ")}</span>}
                {i > 0 && <span className="hint">overridden by {winner.scopeName}</span>}
                <span style={{ flex: 1 }} />
                <span className="hint mono" title="Sampled: counted in steps of 10">~{l.clicks} visits</span>
              </div>
              <div style={{ margin: "16px 0 6px", fontSize: 17 }}>{l.description || <span className="faint">No description</span>}</div>
              <div className="mono" style={{ fontSize: 13, color: "var(--ink-2)", wordBreak: "break-all" }}>{l.url}</div>
              {l.emptyUrl && <div className="mono hint" style={{ marginTop: 4, wordBreak: "break-all" }}>alone: {l.emptyUrl}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 20, alignItems: "center" }}>
                {l.scope !== "global" ? (
                  <>
                    <button className="btn small" onClick={() => setEditing(l._id)}>Edit</button>
                    <button className="btn small ghost danger" onClick={async () => {
                      try { await remove({ token: session.apiToken, linkId: l._id }); say("Deleted"); } catch (e) { say(errText(e)); }
                    }}>Delete</button>
                  </>
                ) : (
                  <a className="btn small" {...linkProps(`/new?k=${encodeURIComponent(l.keyword)}&u=${encodeURIComponent(l.url)}`)}>Override for me</a>
                )}
                <span style={{ flex: 1 }} />
                {l.ownerName && <span className="hint">owned by {l.ownerName}</span>}
              </div>
            </>
          )}
        </div>
      ))}

      {data.history.length > 0 && (
        <div className="section">
          <span className="eyebrow">History</span>
          <ul className="history">
            {data.history.map((h, i) => (
              <li key={h._id}>
                <div className="line"><div className="pip" /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14 }}>
                    <b style={{ fontWeight: 600 }}>{h.editorName}</b> <span className="muted">{{ create: "created it", edit: "changed it", delete: "deleted a copy", revert: "reverted it" }[h.action]}</span>
                    <span className="faint"> · {ago(h._creationTime)}</span>
                  </div>
                  <div className="mono faint" style={{ fontSize: 12, wordBreak: "break-all", marginTop: 2 }}>{h.url}</div>
                </div>
                {i > 0 && h.action !== "delete" && data.links.some((l) => l._id === h.linkId && l.scope !== "global" && l.url !== h.url) ? (
                  <button className="btn small ghost" onClick={async () => {
                    try { await revert({ token: session.apiToken, revisionId: h._id }); say("Reverted"); } catch (e) { say(errText(e)); }
                  }}>Restore</button>
                ) : <span />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {toast}
    </div>
  );
}
