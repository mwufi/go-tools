// go-tools edge server for Cloud Run (or any Node host). Same handler as the
// Cloudflare Worker; the snapshot cache is this instance's memory.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handle } from "../edge/handler";

const convexSite = process.env.CONVEX_SITE;
if (!convexSite) throw new Error("Set CONVEX_SITE, e.g. https://tame-crow-881.convex.site");
const port = Number(process.env.PORT ?? 8080);

async function toRequest(req: IncomingMessage): Promise<Request> {
  const proto = (req.headers["x-forwarded-proto"] as string) ?? "http";
  const url = `${proto}://${req.headers.host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  let body: Buffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request(url, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined });
}

async function send(res: ServerResponse, r: Response) {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => {
    // fetch() already decoded the body; don't pass the upstream encoding/length on.
    if (k !== "content-encoding" && k !== "content-length" && k !== "transfer-encoding") headers[k] = v;
  });
  res.writeHead(r.status, headers);
  res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
}

createServer(async (req, res) => {
  try {
    await send(res, await handle(await toRequest(req), { convexSite, background: (p) => void p.catch(() => {}) }));
  } catch (e) {
    console.error(e);
    res.writeHead(502).end("upstream error");
  }
}).listen(port, () => console.log(`go-edge on :${port} -> ${convexSite}`));
