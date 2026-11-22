// Dev helper: screenshot pages of a running deployment. node scripts/shoot.mjs <site> <outdir> [token]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(require("node:child_process").execSync("npm root -g").toString().trim() + "/playwright")); }
const [site, out, apiToken, searchToken] = process.argv.slice(2);
const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1, colorScheme: scheme });
  if (apiToken) await ctx.addInitScript(([a, s]) => localStorage.setItem("go-tools.session", JSON.stringify({ apiToken: a, searchToken: s })), [apiToken, searchToken]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  const paths = (process.env.PATHS ?? "/").split(",");
  for (const p of paths) {
    await page.goto(site + p, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(Number(process.env.WAIT ?? 1500));
    const name = `${out}/${scheme}-${p.replace(/[^a-z0-9]+/gi, "_") || "root"}.png`;
    await page.screenshot({ path: name, fullPage: process.env.FULL === "1" });
    console.log(name);
  }
  await ctx.close();
}
await browser.close();
