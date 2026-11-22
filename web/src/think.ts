import "./styles.css";
import "./think.css";
import { startShader } from "./shader";
import { SITE_URL } from "./config";

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const q = params.get("q") ?? "";
const t = params.get("t") ?? "";
const base = location.origin.includes("localhost") || location.port === "5173" ? SITE_URL : location.origin;

$("q").textContent = q;
const instead = $("instead") as HTMLAnchorElement;
instead.href = `${base}/s?nollm=1&q=${encodeURIComponent(q)}${t ? `&t=${encodeURIComponent(t)}` : ""}`;

const shader = startShader(document.querySelector("canvas")!, { focus: 0, density: 16, speed: 2.2 });
requestAnimationFrame(() => shader?.setFocus(1));

type Result = { url: string; fallback: boolean; why: string; saveAs: string; learnedId: string | null; ms: number; error?: string };

async function run() {
  const started = performance.now();
  let r: Result;
  try {
    const res = await fetch(`${base}/api/think`, { method: "POST", body: JSON.stringify({ q, t }), headers: { "content-type": "application/json" } });
    r = await res.json();
  } catch {
    location.replace(instead.href);
    return;
  }
  if (r.fallback) {
    $("status").textContent = r.error === "LLM is off" ? "Searching the web" : "No sure answer, searching the web";
    location.replace(r.url);
    return;
  }
  const u = new URL(r.url);
  $("status").textContent = `Found in ${((performance.now() - started) / 1000).toFixed(1)} s`;
  $("host").textContent = u.host.replace(/^www\./, "") + decodeURIComponent(u.pathname + u.search).slice(0, 80);
  $("why").textContent = r.why;
  ($("go") as HTMLAnchorElement).href = r.url;
  const save = $("save") as HTMLAnchorElement;
  if (r.saveAs) {
    save.hidden = false;
    save.textContent = `Save as go/${r.saveAs}`;
    save.href = `${base}/new?k=${encodeURIComponent(r.saveAs)}&u=${encodeURIComponent(r.url)}&d=${encodeURIComponent(r.why)}`;
  }
  const keep = $("keep");
  if (r.learnedId && t) keep.hidden = false;
  $("result").hidden = false;
  document.body.classList.add("found");

  // Go automatically unless the person wants to stay and save it.
  const bar = $("bar");
  bar.style.transition = "transform 1.6s linear";
  requestAnimationFrame(() => (bar.style.transform = "scaleX(1)"));
  const timer = setTimeout(() => location.replace(r.url), 1650);
  const stop = () => {
    clearTimeout(timer);
    bar.style.transition = "none";
    bar.style.transform = "scaleX(0)";
    $("stay").hidden = true;
  };
  $("stay").onclick = stop;
  save.onclick = stop;
  keep.onclick = async () => {
    stop();
    await fetch(`${base}/api/keep`, { method: "POST", body: JSON.stringify({ t, learnedId: r.learnedId }), headers: { "content-type": "application/json" } });
    keep.textContent = "Kept: next time it's instant";
    (keep as HTMLButtonElement).disabled = true;
  };
}
run();
