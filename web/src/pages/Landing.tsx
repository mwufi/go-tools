import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { setSession } from "../store";
import { navigate } from "../router";
import { Arrow, IllusFork, IllusTeam, IllusType, Logo, ShaderCanvas, errText } from "../ui";

const DEMOS: [string, string][] = [
  ["my prs", "github.com/pulls?q=is:open is:pr author:you"],
  ["gh get-convex/convex", "github.com/get-convex/convex"],
  ["cal", "calendar.google.com/calendar/r"],
  ["? prs waiting on me", "github.com/pulls?q=review-requested:you"],
  ["best ramen near soma", "google.com/search?q=best ramen near soma"],
];

function Demo() {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [q, dest] = DEMOS[i];
  useEffect(() => {
    if (n < q.length) {
      const id = setTimeout(() => setN(n + 1), 55 + Math.random() * 60);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => {
      setN(0);
      setI((i + 1) % DEMOS.length);
    }, 2400);
    return () => clearTimeout(id);
  }, [n, q, i]);
  const done = n >= q.length;
  return (
    <div className="demo fade-in d3" aria-hidden>
      <div className="bar">
        <svg width="16" height="16" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5" fill="none" stroke="var(--ink-3)" strokeWidth="1.4" /><path d="M11 11l3 3" stroke="var(--ink-3)" strokeWidth="1.4" strokeLinecap="round" /></svg>
        <span className="typed">{q.slice(0, n)}<span className="caret" /></span>
      </div>
      <div className="to">{done && <span key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}><span style={{ color: "var(--signal)" }}><Arrow /></span>{dest}</span>}</div>
    </div>
  );
}

export function Landing({ signedOutReason }: { signedOutReason?: string }) {
  const signup = useAction(api.users.signup);
  const [mode, setMode] = useState<"join" | "token">("join");
  const [name, setName] = useState("");
  const [github, setGithub] = useState("");
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("invite") ?? "");
  const [token, setToken] = useState("");
  const [err, setErr] = useState(signedOutReason ?? "");
  const [busy, setBusy] = useState(false);
  const check = useQuery(api.users.me, mode === "token" && token.startsWith("goa_") ? { token } : "skip");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (mode === "token") {
      if (!check) return setErr("That token doesn't work. Use an API token (it starts with goa_).");
      setSession({ apiToken: token.trim() });
      navigate("/settings#browser", true);
      return;
    }
    setBusy(true);
    try {
      const t = await signup({ name, github: github || undefined, code: code || undefined });
      setSession(t);
      navigate("/welcome", true);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <header className="topbar" style={{ background: "transparent", backdropFilter: "none", position: "relative" }}>
        <Logo />
        <div className="spacer" />
        <a className="btn ghost small" href="#join">Get started</a>
      </header>

      <section className="bleed">
        <div className="hero">
          <ShaderCanvas density={13} />
          <div>
            <div className="eyebrow fade-in">Shortcuts for your address bar</div>
            <h1 className="display fade-in d1" style={{ marginTop: 22 }}>
              Type a little.<br />
              <em>Arrive</em> anywhere.
            </h1>
            <p className="lede fade-in d2">
              go is a search engine that mostly isn't one. Your shortcuts and your team's go straight to where they point.
              Everything else goes to your usual search, just as fast. Start with <code>?</code> to ask in plain words, and a small model finds the page.
            </p>
            <Demo />
          </div>
        </div>
      </section>

      <section className="section">
        <span className="eyebrow">How it works</span>
        <div className="steps">
          <div className="fade-in">
            <IllusType />
            <span className="n">01</span>
            <h3>Set it once</h3>
            <p>Make go your browser's default search engine. Nothing else about how you type changes.</p>
          </div>
          <div className="fade-in d1">
            <IllusFork />
            <span className="n">02</span>
            <h3>One read, one redirect</h3>
            <p>Each query is a single lookup on Convex. Your shortcuts win, then your team's, then the web.</p>
          </div>
          <div className="fade-in d2">
            <IllusTeam />
            <span className="n">03</span>
            <h3>Share the good ones</h3>
            <p>Team shortcuts anyone can add and fix, with history. Agents can add them too, through the API.</p>
          </div>
        </div>
      </section>

      <section className="section signup" id="join">
        <div>
          <h2 className="title">Claim your <em>go/</em></h2>
          <p className="muted" style={{ maxWidth: 420, marginTop: 14 }}>
            Your GitHub username fills in shortcuts like <code>my prs</code>. You'll get a private search address for your browser, and nothing is shared until you add it to a team.
          </p>
        </div>
        <form className="card form-grid" onSubmit={submit}>
          <div className="seg" style={{ justifySelf: "start" }}>
            <button type="button" className={mode === "join" ? "on" : ""} onClick={() => setMode("join")}>New here</button>
            <button type="button" className={mode === "token" ? "on" : ""} onClick={() => setMode("token")}>I have a token</button>
          </div>
          {mode === "join" ? (
            <>
              <label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Zen" required autoFocus /></label>
              <label className="field"><span>GitHub username</span><input className="input mono" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="mwufi" /></label>
              <label className="field"><span>Invite or team code</span><input className="input mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="from whoever runs this go" /></label>
            </>
          ) : (
            <label className="field"><span>API token</span><input className="input mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="goa_…" autoFocus /><span className="hint">Make one in Settings on a device where you're signed in.</span></label>
          )}
          {err && <div className="error">{err}</div>}
          <button className="btn primary" disabled={busy} style={{ justifySelf: "start" }}>
            {mode === "join" ? (busy ? "Setting up…" : "Create my go") : "Sign in"} <Arrow />
          </button>
        </form>
      </section>
    </div>
  );
}
