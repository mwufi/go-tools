# go-tools

Personal and team **go/ links on Convex**. Set it as your browser's default search engine:
saved shortcuts redirect at once, everything else goes to your normal web search just as fast,
and queries that start with `?` (or end with `!`) ask a small model where you mean.

Design doc: https://claude.ai/artifact/HRJkv7z163WHWHV8YbmYR8

```
my prs                  -> github.com/pulls?q=is:open is:pr author:<you>
pr 3297                 -> github.com/<team org>/cosign/pull/3297
gh get-convex/convex    -> github.com/get-convex/convex
best ramen near soma    -> your web search
? prs waiting on me     -> thinking page -> the model picks a URL (optional)
go/newthing             -> create page for go/newthing
npm+                    -> info page: where it points, who owns it, history
```

## How it works

Everything runs on one Convex deployment. The redirect is a single HTTP action (`/s`)
that makes one query (token lookup + a few index point reads, longest keyword first:
personal, then your teams, then built-ins) and returns a 302. No writes on that path;
click counts are sampled 1 in 10 so the scheduler write doesn't slow redirects.
The web app and the thinking page are built into single HTML files and served by the
same deployment (`convex/lib/assets.ts` is generated), so there is nothing else to host.

| Path | What |
| --- | --- |
| `GET /s?q=&t=` | resolve and redirect (the search-engine URL) |
| `GET /suggest?q=&t=` | OpenSearch suggestions for the address bar |
| `GET /think`, `POST /api/think` | thinking page and the LLM call |
| `GET/POST/DELETE /api/links`, `GET /api/resolve` | JSON API for the CLI and agents (`Authorization: Bearer <api token>`) |
| everything else | the web app |

Templates: `{*}` (all words after the keyword), `{1}` `{2}`, `{me.github}` (your
variables), `{team.github_org}` (the team's), `%s` (bunny1 style). Personal shortcuts
override team ones, which override built-ins (`convex/seed.ts`).

## Edge Worker (fast redirects far from Convex)

Convex runs in US East, so from the West Coast each redirect crosses the country.
`worker/` is a Cloudflare Worker that answers `/s` at the edge location nearest you:

- It keeps a snapshot of your shortcuts, teams and variables (`GET /api/snapshot?t=`),
  in memory and in the colo's cache, and resolves with the same code Convex uses
  (`convex/lib/core.ts`).
- Every redirect is served from the snapshot; a background refresh runs at most every 2 s,
  so another device's edit shows up by the next search.
- The web app pings `/_refresh` on the same edge after every change, so your own edits
  apply on your very next search.
- Everything else (web app, thinking page, API) is proxied to Convex.

```bash
npx wrangler login            # or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
# set CONVEX_SITE in wrangler.toml, then:
npm run deploy:edge
npx convex env set GO_EDGE_URL https://go-tools.<you>.workers.dev   # the app then hands out edge search URLs
```

On GCP instead, see [`deploy/gcp`](deploy/gcp/README.md): the same handler runs on Cloud Run
(`server/node.ts`), one region to start, a global load balancer when you add more.

## Setup

```bash
npm install
npx convex deploy                         # first time: creates/links the deployment
npx convex env set GO_INVITE_CODE <code>  # required: without it anyone can sign up
npx convex run seed:run                   # built-in shortcuts
npm run deploy                            # builds the web app into convex/ and deploys
```

With a dev deploy key (`CONVEX_DEPLOY_KEY=dev:...`), use `npm run deploy:dev` instead.
The hosted instance currently runs on the dev deployment `tame-crow-881`
(https://tame-crow-881.convex.site).

Open `https://<deployment>.convex.site`, sign up with the invite code, and copy your
search URL from the welcome page into your browser's search engine settings.

### Optional: plain-words queries

```bash
npx convex env set LLM_API_KEY <key>
npx convex env set LLM_PROVIDER anthropic       # or "openai" for any OpenAI-compatible API
npx convex env set LLM_MODEL claude-haiku-5-5   # any small, fast model
npx convex env set LLM_BASE_URL <url>           # only for OpenAI-compatible providers
npx convex env set LLM_TIMEOUT_MS 2500          # after this, fall back to web search
```

Without a key, `?` queries just go to web search. URL recipes the model may use live in
`convex/lib/recipes.ts`.

## CLI (and agents)

```bash
npm i -g github:mwufi/go-tools
go login https://<deployment>.convex.site goa_…   # API token from Settings -> Tokens
go add standup https://docs.google.com/… -d "Daily standup" --team a16z-new-media
go ls github
go where pr 3297
go rm standup
```

Any agent can do the same with `curl` and an API token, e.g.
`curl -H "Authorization: Bearer $GO_TOKEN" $GO_URL/api/links`.

## Develop

```bash
npm run dev:web           # Vite on :5173 against VITE_CONVEX_URL in .env.local
npm test                  # parser, templates, hashing
npm run typecheck
```

## Security notes

- Search tokens (in the browser's search URL) can only resolve queries, read the snapshot
  of shortcuts that resolution uses, and keep an LLM answer for you. API tokens can change shortcuts. Tokens are stored as hashes.
- The search URL ends up in browser history; revoke a token in Settings if it leaks.
- Team join codes let anyone holding them join and edit team shortcuts; rotate them in Settings.
