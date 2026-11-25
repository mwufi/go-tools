import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { startShader } from "./shader";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size * 2.1} height={size} viewBox="0 0 46 22" aria-label="go">
      <text x="0" y="16.5" fontFamily="var(--mono)" fontSize="17" fontWeight="500" fill="var(--ink)">go</text>
      <path d="M25 19 L33 3" stroke="var(--signal)" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M36 11 h8 m-3.2 -3.4 L44.2 11 l-3.4 3.4" stroke="var(--ink-3)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShaderCanvas({ focus = 0, density = 14, speed = 1 }: { focus?: number; density?: number; speed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const handle = useRef<ReturnType<typeof startShader>>(null);
  useEffect(() => {
    handle.current = startShader(ref.current!, { focus, density, speed });
    return () => handle.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => handle.current?.setFocus(focus), [focus]);
  return <canvas ref={ref} className="shader" aria-hidden />;
}

const S = { fill: "none", stroke: "var(--ink)", strokeWidth: 1.25, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const A = { ...S, stroke: "var(--signal)", strokeWidth: 1.75 };

/** Step 1: your address bar. */
export function IllusType() {
  return (
    <svg width="132" height="72" viewBox="0 0 132 72" aria-hidden>
      <rect x="2" y="20" width="128" height="32" rx="16" {...S} />
      <circle cx="20" cy="36" r="5" {...S} />
      <path d="M24 40l4 4" {...S} />
      <text x="36" y="40.5" fontFamily="var(--mono)" fontSize="12" fill="var(--ink)">my prs</text>
      <path d="M83 29v14" {...A} />
      <path d="M100 36h20m-5-5 5 5-5 5" {...S} stroke="var(--ink-3)" />
    </svg>
  );
}

/** Step 2: one query, many places, one route taken. */
export function IllusFork() {
  return (
    <svg width="132" height="72" viewBox="0 0 132 72" aria-hidden>
      <path d="M4 36h34" {...S} />
      <path d="M38 36c18 0 22-24 44-24h22" {...S} stroke="var(--ink-3)" />
      <path d="M38 36c18 0 22 24 44 24h22" {...S} stroke="var(--ink-3)" />
      <path d="M38 36h66" {...A} />
      <circle cx="38" cy="36" r="3" {...S} fill="var(--paper)" />
      <circle cx="112" cy="12" r="5" {...S} stroke="var(--ink-3)" />
      <circle cx="112" cy="60" r="5" {...S} stroke="var(--ink-3)" />
      <circle cx="112" cy="36" r="7" {...A} />
      <circle cx="112" cy="36" r="2.4" fill="var(--signal)" />
    </svg>
  );
}

/** Step 3: a shortcut the whole team shares. */
export function IllusTeam() {
  return (
    <svg width="132" height="72" viewBox="0 0 132 72" aria-hidden>
      <rect x="44" y="22" width="44" height="28" rx="6" {...S} />
      <path d="M52 32h20M52 40h28" {...S} stroke="var(--ink-3)" />
      <path d="M80 22v-6l5 3 5-3v6" {...A} transform="translate(-8 0)" />
      {[[14, 14], [14, 58], [118, 36]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="7" {...S} />
          <path d={`M${x < 66 ? x + 7 : x - 7} ${y}L${x < 66 ? 44 : 88} ${y < 36 ? 28 : y > 36 ? 44 : 36}`} {...S} strokeDasharray="2 3" stroke="var(--ink-3)" />
        </g>
      ))}
    </svg>
  );
}

/** Empty state: a signpost with nowhere to point yet. */
export function IllusSignpost({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <path d="M60 18v90" {...S} strokeWidth={1.5} />
      <path d="M26 108h68" {...S} stroke="var(--ink-3)" />
      <path d="M60 28h36l8 8-8 8H60z" {...A} fill="var(--signal-soft)" />
      <path d="M60 54H26l-8 8 8 8h34z" {...S} />
      <path d="M32 62h18" {...S} stroke="var(--ink-3)" strokeDasharray="2 4" />
      <path d="M68 36h18" {...A} strokeWidth={1.25} strokeDasharray="2 4" />
      <circle cx="60" cy="18" r="2.5" fill="var(--ink)" />
    </svg>
  );
}

/** A small destination illustration: a route ending at a pin. */
export function IllusArrive({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d="M6 54c10 0 10-14 20-14s12 10 22 0" {...S} stroke="var(--ink-3)" strokeDasharray="2 4" />
      <path d="M48 40c0 0-10-11-10-18a10 10 0 0 1 20 0c0 7-10 18-10 18z" {...A} fill="var(--signal-soft)" />
      <circle cx="48" cy="22" r="3" fill="var(--signal)" />
    </svg>
  );
}

export function useToast(): [ReactNode, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(id);
  }, [msg]);
  return [msg ? createPortal(<div className="toast" role="status">{msg}</div>, document.body) : null, setMsg];
}

export function CopyField({ value, label = "Copy", onCopied }: { value: string; label?: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  return (
    <div className="copy">
      <code title={value}>{value}</code>
      <button
        className="btn small"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => {});
          setDone(true);
          onCopied?.();
          setTimeout(() => setDone(false), 1400);
        }}
      >
        {done ? "Copied" : label}
      </button>
    </div>
  );
}

export function ScopeChip({ scope, name }: { scope: string; name: string }) {
  return (
    <span className={`chip ${scope}`}>
      <span className="dot" />
      {name}
    </span>
  );
}

export function hostOf(url: string) {
  try {
    const u = new URL(url.replace(/\{[^}]*\}/g, "x"));
    return u.host.replace(/^www\./, "") + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

export function errText(e: unknown) {
  const s = String((e as Error)?.message ?? e);
  const m = /Uncaught Error: (.*?)(\n|$)/.exec(s);
  return (m ? m[1] : s).replace(/^\[.*?\]\s*/, "").replace(/ at handler.*$/, "");
}

export function Arrow() {
  return (
    <svg className="arrow" width="18" height="10" viewBox="0 0 18 10" aria-hidden>
      <path d="M1 5h15m-4-4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A link that signs someone up (or, if they're signed in, offers to join) with a team's code. */
export function inviteLink(code: string) {
  return `${location.origin}/?invite=${encodeURIComponent(code)}`;
}
