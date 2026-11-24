import { useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useSession } from "../store";
import { linkProps, navigate } from "../router";
import { CopyField, ShaderCanvas, errText, useToast } from "../ui";
import { VarsEditor } from "./Settings";

const MAX_BYTES = 5 * 1024 * 1024;
const since = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", year: "numeric" });
const joined = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function Monogram({ name, size }: { name: string; size: number }) {
  return (
    <span className="monogram" style={{ width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
      {name.trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function Face({ name, github, size = 36 }: { name: string; github: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!github || broken) return <Monogram name={name} size={size} />;
  return <img className="face" src={`https://github.com/${encodeURIComponent(github)}.png?size=${size * 2}`} width={size} height={size} alt="" onError={() => setBroken(true)} />;
}

/** A hidden file input behind a button. */
function Picker({ label, busy, onPick }: { label: string; busy: boolean; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (f) onPick(f);
      }} />
      <button className="btn small" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Uploading…" : label}</button>
    </>
  );
}

export function Team({ slug }: { slug: string }) {
  const session = useSession()!;
  const t = session.apiToken;
  const team = useQuery(api.teams.detail, { token: t, slug });
  const uploadUrl = useMutation(api.teams.imageUploadUrl);
  const setImage = useMutation(api.teams.setImage);
  const update = useMutation(api.teams.update);
  const setRole = useMutation(api.teams.setRole);
  const remove = useMutation(api.teams.removeMember);
  const setVars = useMutation(api.teams.setVars);
  const leave = useMutation(api.teams.leave);
  const rotate = useAction(api.teams.rotateJoinCode);
  const [toast, say] = useToast();
  const [busy, setBusy] = useState<"avatar" | "header" | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  if (team === undefined) return null;
  if (team === null)
    return (
      <div className="empty fade-in" style={{ paddingTop: 120 }}>
        <h1 className="title">No team <em>here</em>.</h1>
        <p>Either it doesn't exist or you're not on it.</p>
        <a className="btn" {...linkProps("/settings#teams")}>Your teams</a>
      </div>
    );

  const admin = team.myRole === "admin";
  const teamId = team._id as Id<"teams">;
  const run = async (f: () => Promise<unknown>, done?: string) => {
    try { await f(); if (done) say(done); } catch (e) { say(errText(e)); }
  };
  const upload = async (kind: "avatar" | "header", file: File) => {
    if (!file.type.startsWith("image/")) return say("Pick an image file");
    if (file.size > MAX_BYTES) return say("That image is over 5 MB");
    setBusy(kind);
    await run(async () => {
      const url = await uploadUrl({ token: t, teamId });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("Upload failed, try again");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await setImage({ token: t, teamId, kind, storageId });
    }, kind === "avatar" ? "Picture updated" : "Cover updated");
    setBusy(null);
  };

  return (
    <div className="team fade-in">
      <div className={`cover${team.headerUrl ? " has-image" : ""}`}>
        {team.headerUrl ? <img src={team.headerUrl} alt="" /> : <ShaderCanvas density={11} speed={0.6} />}
        {admin && (
          <div className="cover-actions">
            <Picker label={team.headerUrl ? "Change cover" : "Add cover"} busy={busy === "header"} onPick={(f) => upload("header", f)} />
            {team.headerUrl && <button className="btn small" onClick={() => run(() => setImage({ token: t, teamId, kind: "header" }), "Cover removed")}>Remove</button>}
          </div>
        )}
      </div>

      <div className="team-head">
        <div className="team-avatar">
          {team.avatarUrl ? <img src={team.avatarUrl} alt="" /> : <Monogram name={team.name} size={104} />}
        </div>
        <div className="team-title">
          {editing ? (
            <form className="form-grid" style={{ gap: 10 }} onSubmit={async (e) => {
              e.preventDefault();
              await run(() => update({ token: t, teamId, name, about }), "Saved");
              setEditing(false);
            }}>
              <input id="team-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Team name" required />
              <textarea id="team-about" className="input" value={about} onChange={(e) => setAbout(e.target.value)} maxLength={280} rows={2} placeholder="What this team is, in a line or two" aria-label="About" />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn small primary">Save</button>
                <button type="button" className="btn small ghost" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <h1 className="title" style={{ margin: 0 }}>{team.name}</h1>
              {team.about ? <p className="about">{team.about}</p> : admin && <p className="about faint">Add a line about what this team is.</p>}
              <div className="stats">
                <span><b>{team.members.length}</b> {team.members.length === 1 ? "member" : "members"}</span>
                <span><b>{team.shortcutCount}</b> team {team.shortcutCount === 1 ? "shortcut" : "shortcuts"}</span>
                <span>since {since(team.createdAt)}</span>
                <span className="chip">{admin ? "you're an admin" : "member"}</span>
              </div>
            </>
          )}
        </div>
        {admin && !editing && (
          <div className="team-tools">
            <Picker label={team.avatarUrl ? "Change picture" : "Add picture"} busy={busy === "avatar"} onPick={(f) => upload("avatar", f)} />
            <button className="btn small" onClick={() => { setName(team.name); setAbout(team.about); setEditing(true); }}>Edit details</button>
          </div>
        )}
      </div>

      <section className="team-section">
        <div className="section-head">
          <h2>Members</h2>
          {admin && <button className="btn small" onClick={async () => setCode(await rotate({ token: t, teamId }))}>Invite someone</button>}
        </div>
        {code && (
          <div style={{ marginBottom: 18 }}>
            <CopyField value={code} />
            <p className="hint">Send this join code. Anyone with it can join and edit team shortcuts. Making a new one turns off the old one.</p>
          </div>
        )}
        <div className="members">
          {team.members.map((m) => (
            <div className="member" key={m.userId}>
              <Face name={m.name} github={m.github} />
              <div className="who">
                <div className="name">{m.name}{m.isMe && <span className="faint"> (you)</span>}</div>
                {m.github && <a className="handle" href={`https://github.com/${m.github}`} target="_blank" rel="noreferrer">@{m.github}</a>}
              </div>
              <span className={`chip${m.role === "admin" ? " user" : ""}`}>{m.role}</span>
              <span className="meta">{m.shortcuts} added</span>
              <span className="meta">joined {joined(m.joinedAt)}</span>
              <div className="actions">
                {admin && !m.isMe && (
                  <>
                    <button className="btn small ghost" onClick={() => run(() => setRole({ token: t, teamId, userId: m.userId, role: m.role === "admin" ? "member" : "admin" }), m.role === "admin" ? `${m.name} is now a member` : `${m.name} is now an admin`)}>
                      {m.role === "admin" ? "Make member" : "Make admin"}
                    </button>
                    {confirming === m.userId ? (
                      <button className="btn small danger" onClick={() => { setConfirming(null); run(() => remove({ token: t, teamId, userId: m.userId }), `Removed ${m.name}`); }}>Confirm remove</button>
                    ) : (
                      <button className="btn small ghost danger" onClick={() => { setConfirming(m.userId); setTimeout(() => setConfirming((c) => (c === m.userId ? null : c)), 4000); }}>Remove</button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="team-section">
        <div className="section-head"><h2>Team variables</h2></div>
        <p className="muted" style={{ marginTop: 0 }}>Team shortcuts fill <code>{"{team.name}"}</code> placeholders from these.</p>
        <VarsEditor value={team.vars} suggestions={["github_org", "linear", "slack"]} onSave={async (vars) => { await setVars({ token: t, teamId, vars }); say("Saved"); }} />
      </section>

      <div style={{ marginTop: 32 }}>
        <button className="btn small ghost danger" onClick={() => run(async () => { await leave({ token: t, teamId }); navigate("/settings#teams"); })}>Leave team</button>
      </div>
      {toast}
    </div>
  );
}
