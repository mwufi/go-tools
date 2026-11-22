#!/usr/bin/env node
// go: manage go-tools shortcuts from a terminal or an agent. No dependencies.
//   go login <site-url> <api-token>    save credentials (~/.config/go-tools.json)
//   go ls [filter]                     list shortcuts you can see
//   go add <keyword> <url> [-d "what it's for"] [--team <slug>]
//   go rm <keyword>                    delete your (or your team's) shortcut
//   go where <query...>                print where a query would go
//   go open <query...>                 open it in the browser
// Env overrides: GO_URL, GO_TOKEN.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";

const CONF = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "go-tools.json");
const conf = (() => { try { return JSON.parse(readFileSync(CONF, "utf8")); } catch { return {}; } })();
const URL_ = (process.env.GO_URL ?? conf.url ?? "").replace(/\/$/, "");
const TOKEN = process.env.GO_TOKEN ?? conf.token;
const [cmd, ...rest] = process.argv.slice(2);

const die = (m) => { console.error(m); process.exit(1); };
const flag = (name) => { const i = rest.indexOf(name); if (i < 0) return undefined; const v = rest[i + 1]; rest.splice(i, 2); return v; };
async function call(method, path, body) {
  if (!URL_ || !TOKEN) die("Run: go login <site-url> <api-token>   (make a token in Settings → Tokens)");
  const res = await fetch(URL_ + path, { method, headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) die(out.error ?? `HTTP ${res.status}`);
  return out;
}

switch (cmd) {
  case "login": {
    const [url, token] = rest;
    if (!url || !token) die("go login <site-url> <api-token>");
    mkdirSync(join(CONF, ".."), { recursive: true });
    writeFileSync(CONF, JSON.stringify({ url: url.replace(/\/$/, ""), token }, null, 2), { mode: 0o600 });
    console.log(`Saved to ${CONF}`);
    break;
  }
  case "ls": {
    const f = (rest[0] ?? "").toLowerCase();
    const links = (await call("GET", "/api/links")).filter((l) => !f || l.keyword.includes(f) || l.description.toLowerCase().includes(f));
    const w = Math.max(...links.map((l) => l.keyword.length), 4) + 4;
    for (const l of links) console.log(`go/${l.keyword}`.padEnd(w + 3), `${l.scope}`.padEnd(16), l.url);
    break;
  }
  case "add": {
    const description = flag("-d") ?? flag("--description");
    const team = flag("--team");
    const [keyword, url] = rest;
    if (!keyword || !url) die('go add <keyword> <url> [-d "what it\'s for"] [--team <slug>]');
    const r = await call("POST", "/api/links", { keyword, url, description, team });
    console.log(`${r.created ? "Created" : "Updated"} go/${keyword}`);
    break;
  }
  case "rm": {
    const k = rest.join(" ").toLowerCase();
    const links = (await call("GET", "/api/links")).filter((l) => l.keyword === k && l.scope !== "Everyone");
    if (!links.length) die(`No shortcut of yours or your team's called go/${k}`);
    await call("DELETE", `/api/links?id=${links[0].id}`);
    console.log(`Deleted go/${k} (${links[0].scope})`);
    break;
  }
  case "where":
  case "open": {
    const q = rest.join(" ");
    const r = await call("GET", `/api/resolve?q=${encodeURIComponent(q)}`);
    const url = r.url ?? (r.kind === "think" ? `${URL_}/think?q=${encodeURIComponent(r.q)}` : `${URL_}/${r.kind === "create" ? `new?k=${r.keyword}` : r.kind === "info" ? `i/${r.keyword}` : ""}`);
    if (cmd === "where") console.log(`${r.kind}${r.keyword ? ` go/${r.keyword}` : ""}\t${url}`);
    else execFile(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [url]);
    break;
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
}
