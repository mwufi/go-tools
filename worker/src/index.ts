// go-tools edge Worker (Cloudflare). All logic lives in edge/handler.ts;
// shortcuts live in D1, which Convex keeps current by push.
import { handle } from "../../edge/handler";
import { D1Store } from "./d1";

interface Env {
  CONVEX_SITE: string;
  EDGE_SYNC_SECRET?: string;
  DB: D1Database;
}

let store: D1Store | undefined;

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    store ??= new D1Store(env.DB);
    return handle(req, {
      convexSite: env.CONVEX_SITE,
      syncSecret: env.EDGE_SYNC_SECRET,
      store,
      checkEveryMs: 5 * 60_000, // pushes keep D1 current; this only catches a missed one
      background: (p) => ctx.waitUntil(p),
    });
  },
} satisfies ExportedHandler<Env>;
