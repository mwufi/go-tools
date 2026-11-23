// go-tools edge Worker (Cloudflare). All logic lives in edge/handler.ts;
// this adds the colo cache as a second tier and waitUntil for background work.
import { handle, type Entry } from "../../edge/handler";

interface Env {
  CONVEX_SITE: string;
}

const CACHE_HOST = "https://go-snapshot.internal/";

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(req, {
      convexSite: env.CONVEX_SITE,
      background: (p) => ctx.waitUntil(p),
      async getShared(key) {
        const r = await caches.default.match(CACHE_HOST + key);
        return r ? ((await r.json()) as Entry) : null;
      },
      async putShared(key, e) {
        await caches.default.put(
          CACHE_HOST + key,
          new Response(JSON.stringify(e), { headers: { "content-type": "application/json", "cache-control": "max-age=2592000" } }),
        );
      },
    });
  },
} satisfies ExportedHandler<Env>;
