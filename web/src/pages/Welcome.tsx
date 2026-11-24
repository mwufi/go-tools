import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useSession } from "../store";
import { linkProps } from "../router";
import { Arrow, IllusArrive, errText } from "../ui";
import { BrowserSetup } from "./BrowserSetup";
import { Bookmarklet } from "./Bookmarklet";

export function Welcome() {
  const session = useSession()!;
  const me = useQuery(api.users.me, { token: session.apiToken });
  const act = useQuery(api.activity.mine, { token: session.apiToken });
  const update = useMutation(api.users.updateSettings);
  const [github, setGithub] = useState("");
  const [err, setErr] = useState("");
  const works = !!act?.firstSearchAt;
  const needsGithub = me && !me.vars.github;

  return (
    <div className="fade-in" style={{ marginTop: 56, maxWidth: 760 }}>
      <IllusArrive size={72} />
      <h1 className="title" style={{ marginTop: 16 }}>You're in. <em>Two</em> minutes left.</h1>

      <div className="step" style={{ marginTop: 28 }}>
        <span className="n">01</span>
        <div>
          <h3>Make go your browser's search</h3>
          <p>Paste this address as your default search engine. It has your private token in it, so keep it to yourself.</p>
          <BrowserSetup />
          {works ? (
            <div className="status ok"><span className="pulse" />It works. Your searches are going through go now.</div>
          ) : (
            <div className="status"><span className="pulse" />Waiting for your first search. Type <code>{needsGithub ? "gh" : "my prs"}</code> in a new tab's address bar.</div>
          )}
        </div>
      </div>

      {needsGithub && (
        <div className="step">
          <span className="n">02</span>
          <div>
            <h3>Add your GitHub username</h3>
            <p>Shortcuts like <code>my prs</code> and <code>reviews</code> fill it in for you.</p>
            <form style={{ display: "flex", gap: 8, maxWidth: 420 }} onSubmit={async (e) => {
              e.preventDefault();
              setErr("");
              try { await update({ token: session.apiToken, vars: { ...me.vars, github: github.trim().replace(/^@/, "") } }); } catch (x) { setErr(errText(x)); }
            }}>
              <input className="input mono" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="your-username" required />
              <button className="btn">Save</button>
            </form>
            {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
          </div>
        </div>
      )}

      <div className="step">
        <span className="n">{needsGithub ? "03" : "02"}</span>
        <div>
          <h3>Save pages as you go</h3>
          <p>The fastest way to build up shortcuts is to save the pages you keep coming back to.</p>
          <Bookmarklet />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <a className="btn primary" {...linkProps("/")}>{works ? "Show my shortcuts" : "Skip for now"} <Arrow /></a>
      </div>
    </div>
  );
}
