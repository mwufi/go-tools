import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { useSession } from "../store";
import { linkProps } from "../router";

type LinkRow = Doc<"links"> & { ownerName: string | null; scopeName: string };

const LAST_VISIT = "go-tools.lastHome";
const DAY = 86_400_000;

function ago(ms: number) {
  const d = Math.floor((Date.now() - ms) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** When you last opened the home page in this browser, read once per visit. */
function useLastVisit() {
  const [last] = useState(() => {
    try { return Number(localStorage.getItem(LAST_VISIT)) || 0; } catch { return 0; }
  });
  useEffect(() => {
    try { localStorage.setItem(LAST_VISIT, String(Date.now())); } catch { /* private mode */ }
  }, []);
  return last;
}

/** "This week: ~140 searches · 112 by shortcut · 4-day streak" */
export function WeekLine() {
  const session = useSession()!;
  const act = useQuery(api.activity.mine, { token: session.apiToken });
  if (!act) return null;
  if (!act.firstSearchAt)
    return (
      <div className="weekline">
        <span>No searches from your browser yet. <a {...linkProps("/welcome")}>Finish setting up</a> so your address bar uses go.</span>
      </div>
    );
  const { shortcuts, days } = act.week;
  if (!days) return null;
  return (
    <div className="weekline">
      <span>Used go on <b>{days}</b> of the last 7 days</span>
      {shortcuts > 0 && <span title="Sampled, so it's approximate"><b>~{shortcuts}</b> trips by shortcut this week</span>}
      {act.streak > 1 && <span><b>{act.streak}</b>-day streak</span>}
    </div>
  );
}

/** Missed searches worth a shortcut, what teammates keep looking for, and what's new on your teams. */
export function Nudges({ links, myId }: { links: LinkRow[] | undefined; myId: string | undefined }) {
  const session = useSession()!;
  const act = useQuery(api.activity.mine, { token: session.apiToken });
  const dismiss = useMutation(api.activity.dismiss);
  const last = useLastVisit();

  const fresh = (links ?? [])
    .filter((l) => l.scope === "team" && l.ownerId && l.ownerId !== myId && l._creationTime > Date.now() - 14 * DAY)
    .sort((a, b) => b._creationTime - a._creationTime)
    .slice(0, 5);
  const suggestions = act?.suggestions ?? [];
  const wanted = act?.wanted ?? [];
  if (!fresh.length && !suggestions.length && !wanted.length) return null;

  return (
    <div className="nudges fade-in d2">
      {(suggestions.length > 0 || wanted.length > 0) && (
        <div className="card">
          <span className="eyebrow">Worth a shortcut</span>
          <div className="nudge-list">
            {suggestions.map((s) => (
              <div className="nudge" key={s._id}>
                <span className="q">{s.query}</span>
                <span className="why">
                  you searched it {s.count} times
                  {s.near && <> · did you mean <a {...linkProps(`/i/${encodeURIComponent(s.near)}`)}>go/{s.near}</a>?</>}
                </span>
                <a className="btn small" {...linkProps(`/new?k=${encodeURIComponent(s.query)}`)}>Make it</a>
                <button className="btn small ghost" aria-label={`Dismiss ${s.query}`} onClick={() => dismiss({ token: session.apiToken, missId: s._id })}>×</button>
              </div>
            ))}
            {wanted.map((w) => (
              <div className="nudge" key={`${w.teamId}:${w.query}`}>
                <span className="q">{w.query}</span>
                <span className="why">{w.people} teammates looked for it</span>
                <a className="btn small" {...linkProps(`/new?k=${encodeURIComponent(w.query)}&team=${w.teamId}`)}>Add for the team</a>
              </div>
            ))}
          </div>
        </div>
      )}
      {fresh.length > 0 && (
        <div className="card">
          <span className="eyebrow">New on your team</span>
          <div className="nudge-list" style={{ gap: 2 }}>
            {fresh.map((l) => (
              <a className="feed-item" key={l._id} {...linkProps(`/i/${encodeURIComponent(l.keyword)}`)}>
                {l._creationTime > last && last > 0 ? <span className="new" title="New since your last visit" /> : null}
                <span className="kw">go/{l.keyword}</span>
                <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.description}</span>
                <span className="who">{l.ownerName} · {ago(l._creationTime)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
