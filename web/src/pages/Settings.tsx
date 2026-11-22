import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { setSession, useSession } from "../store";
import { navigate } from "../router";
import { CopyField, errText, useToast } from "../ui";
import { BrowserSetup } from "./BrowserSetup";

function VarsEditor({ value, onSave, suggestions }: { value: Record<string, string>; onSave: (v: Record<string, string>) => Promise<void>; suggestions: string[] }) {
  const [pairs, setPairs] = useState<[string, string][]>(() => {
    const p = Object.entries(value);
    return p.length ? p : [[suggestions[0] ?? "", ""]];
  });
  const [err, setErr] = useState("");
  const dirty = JSON.stringify(Object.fromEntries(pairs.filter(([k, v]) => k && v))) !== JSON.stringify(value);
  return (
    <div className="vars">
      {pairs.map(([k, v], i) => (
        <div className="pair" key={i}>
          <input className="input mono" value={k} placeholder="name" onChange={(e) => setPairs(pairs.map((p, j) => (j === i ? [e.target.value, p[1]] : p)))} />
          <input className="input mono" value={v} placeholder="value" onChange={(e) => setPairs(pairs.map((p, j) => (j === i ? [p[0], e.target.value] : p)))} />
          <button className="btn ghost small" aria-label="Remove" onClick={() => setPairs(pairs.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      {err && <div className="error">{err}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button className="btn small" onClick={() => setPairs([...pairs, [suggestions.find((s) => !pairs.some(([k]) => k === s)) ?? "", ""]])}>Add variable</button>
        <button className="btn small primary" disabled={!dirty} onClick={async () => {
          setErr("");
          try { await onSave(Object.fromEntries(pairs.filter(([k, v]) => k && v))); } catch (e) { setErr(errText(e)); }
        }}>Save</button>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, title, children }: { checked: boolean; onChange: (v: boolean) => void; title: string; children: React.ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span><b style={{ fontWeight: 600 }}>{title}</b><br /><span className="muted" style={{ fontSize: 14 }}>{children}</span></span>
    </label>
  );
}

function TeamCard({ team }: { team: { _id: Id<"teams">; name: string; slug: string; vars: Record<string, string>; role: string } }) {
  const session = useSession()!;
  const members = useQuery(api.teams.members, { token: session.apiToken, teamId: team._id });
  const setVars = useMutation(api.teams.setVars);
  const leave = useMutation(api.teams.leave);
  const rotate = useAction(api.teams.rotateJoinCode);
  const [code, setCode] = useState<string | null>(null);
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <div className="serif" style={{ fontSize: 26 }}>{team.name}</div>
        <span className="chip">{team.role}</span>
        <span style={{ flex: 1 }} />
        <span className="hint">{members?.map((m) => m.name).join(", ")}</span>
      </div>
      <div className="eyebrow" style={{ margin: "20px 0 10px" }}>Team variables</div>
      <VarsEditor value={team.vars} suggestions={["github_org", "linear", "slack"]} onSave={async (vars) => { await setVars({ token: session.apiToken, teamId: team._id, vars }); }} />
      <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
        {team.role === "admin" && <button className="btn small" onClick={async () => setCode(await rotate({ token: session.apiToken, teamId: team._id }))}>New invite code</button>}
        <button className="btn small ghost danger" onClick={() => leave({ token: session.apiToken, teamId: team._id })}>Leave team</button>
      </div>
      {code && <div style={{ marginTop: 12 }}><CopyField value={code} /><p className="hint">Anyone with this code can join and edit team shortcuts. Old codes stop working.</p></div>}
    </div>
  );
}

export function Settings() {
  const session = useSession()!;
  const me = useQuery(api.users.me, { token: session.apiToken });
  const update = useMutation(api.users.updateSettings);
  const createToken = useAction(api.users.createToken);
  const revoke = useMutation(api.users.revokeToken);
  const createTeam = useAction(api.teams.create);
  const join = useMutation(api.teams.join);
  const [toast, say] = useToast();
  const [fresh, setFresh] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 50);
  }, []);
  if (!me) return null;
  const t = session.apiToken;
  const isCustom = !me.engines.some((e) => e.key === me.fallbackSearch);

  return (
    <div className="settings fade-in">
      <aside>
        {[["browser", "Browser"], ["variables", "Variables"], ["search", "Web search"], ["llm", "Plain-words queries"], ["teams", "Teams"], ["tokens", "Tokens"]].map(([id, label]) => (
          <a key={id} href={`#${id}`}>{label}</a>
        ))}
      </aside>
      <div>
        <section id="browser">
          <h2>Browser</h2>
          <p>Make this your default search engine. Shortcuts redirect at once, everything else goes to your web search.</p>
          <BrowserSetup />
        </section>

        <section id="variables">
          <h2>Your variables</h2>
          <p>Shortcuts fill <code>{"{me.name}"}</code> placeholders from these, so one team shortcut works for everyone.</p>
          <VarsEditor value={me.vars} suggestions={["github", "linear", "email"]} onSave={async (vars) => { await update({ token: t, vars }); say("Saved"); }} />
        </section>

        <section id="search">
          <h2>Web search</h2>
          <p>Where queries go when no shortcut matches.</p>
          <div className="seg">
            {me.engines.map((e) => (
              <button key={e.key} className={me.fallbackSearch === e.key ? "on" : ""} onClick={() => update({ token: t, fallbackSearch: e.key })}>{e.name}</button>
            ))}
            <button className={isCustom ? "on" : ""} onClick={() => setCustom(isCustom ? me.fallbackSearch : "https://")}>Custom</button>
          </div>
          {(isCustom || custom) && (
            <form style={{ display: "flex", gap: 8, marginTop: 12 }} onSubmit={async (e) => { e.preventDefault(); try { await update({ token: t, fallbackSearch: custom }); say("Saved"); } catch (err) { say(errText(err)); } }}>
              <input className="input mono" value={custom || me.fallbackSearch} onChange={(e) => setCustom(e.target.value)} placeholder="https://example.com/search?q={*}" />
              <button className="btn">Save</button>
            </form>
          )}
        </section>

        <section id="llm">
          <h2>Plain-words queries</h2>
          <p>
            Start a query with <code>?</code> or end it with <code>!</code> and a small model picks the page, using your shortcuts and variables. Ordinary searches never wait on it.
          </p>
          {!me.llmConfigured && <p className="hint" style={{ marginTop: -10 }}>No model is configured on this deployment yet (set <code>LLM_API_KEY</code>), so these go to web search for now.</p>}
          <div className="form-grid">
            <Toggle checked={me.llmEnabled} onChange={(v) => update({ token: t, llmEnabled: v })} title="Use the model">Only for <code>?</code> queries and, below, <code>my …</code> queries.</Toggle>
            <Toggle checked={me.llmMy} onChange={(v) => update({ token: t, llmMy: v })} title={"Also for “my …”"}>An unmatched query that starts with <code>my</code>, like <code>my open linear issues</code>, asks the model too.</Toggle>
          </div>
        </section>

        <section id="teams">
          <h2>Teams</h2>
          <p>Team shortcuts are shared with everyone on the team. Anyone can add or fix one; history keeps every version.</p>
          {me.teams.map((team) => <TeamCard key={team._id} team={team} />)}
          <div className="two" style={{ marginTop: 18 }}>
            <form className="field" onSubmit={async (e) => { e.preventDefault(); try { const r = await createTeam({ token: t, name: teamName }); setNewCode(r.joinCode); setTeamName(""); } catch (err) { say(errText(err)); } }}>
              <span>Start a team</span>
              <div style={{ display: "flex", gap: 8 }}><input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name" required /><button className="btn">Create</button></div>
            </form>
            <form className="field" onSubmit={async (e) => { e.preventDefault(); try { say(`Joined ${await join({ token: t, code: joinCode })}`); setJoinCode(""); } catch (err) { say(errText(err)); } }}>
              <span>Join with a code</span>
              <div style={{ display: "flex", gap: 8 }}><input className="input mono" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="team-…" required /><button className="btn">Join</button></div>
            </form>
          </div>
          {newCode && <div style={{ marginTop: 14 }}><p className="hint">Share this code to invite people. It's shown once.</p><CopyField value={newCode} /></div>}
        </section>

        <section id="tokens" style={{ borderBottom: 0 }}>
          <h2>Tokens</h2>
          <p>Search tokens go in a browser's search URL and can only look things up. API tokens can change shortcuts: use one per agent or CLI.</p>
          <div className="tokens">
            {me.tokens.map((tk) => (
              <div key={tk._id}>
                <span className="chip" style={{ width: 62, justifyContent: "center" }}>{tk.kind}</span>
                <span style={{ flex: 1 }}>{tk.label} <span className="faint mono">…{tk.hint}</span></span>
                <span className="hint">{new Date(tk.createdAt).toLocaleDateString()}</span>
                <button className="btn small ghost danger" onClick={async () => { try { await revoke({ token: t, tokenId: tk._id }); say("Revoked"); } catch (e) { say(errText(e)); } }}>Revoke</button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn small" onClick={async () => { const s = await createToken({ token: t, kind: "search", label: "Browser" }); setSession({ ...session, searchToken: s }); say("New search URL is under Browser"); }}>New search token</button>
            <button className="btn small" onClick={async () => setFresh(await createToken({ token: t, kind: "api", label: "Agent" }))}>New API token</button>
            <span style={{ flex: 1 }} />
            <button className="btn small ghost" onClick={() => { setSession(null); navigate("/", true); }}>Sign out of this browser</button>
          </div>
          {fresh && (
            <div style={{ marginTop: 14 }}>
              <p className="hint">Copy it now; it won't be shown again. Use it with the CLI (<code>go login</code>) or as <code>Authorization: Bearer …</code> on <code>/api/links</code>.</p>
              <CopyField value={fresh} />
            </div>
          )}
        </section>
      </div>
      {toast}
    </div>
  );
}
