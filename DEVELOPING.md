# Developing go-tools

Everything a new machine, teammate or agent session needs to work on go-tools.
Secret values never go in this repo. Each one below says where it's kept.

## What runs where

| Piece | Where | Name |
| --- | --- | --- |
| Backend, database, web app | Convex **dev** deployment | `tame-crow-881` (https://tame-crow-881.convex.site) |
| Edge (fast `/s` redirects) | Cloudflare Worker | `go-tools` → https://go-tools.go-tools.workers.dev |
| Edge's copy of shortcuts | Cloudflare D1 (WNAM) | `go-tools`, id in `wrangler.toml` |
| Optional edge on GCP | Cloud Run (Terraform in `deploy/gcp`) | not deployed |

The search URL people use is `https://go-tools.go-tools.workers.dev/s?q=%s&t=<search token>`.
The web app shows it under Settings → Browser.

## Credentials you need on your machine

| Variable | What it is | Where to get it |
| --- | --- | --- |
| `CONVEX_DEPLOY_KEY` | `dev:tame-crow-881\|…` deploy key | Convex dashboard → go-tools → Settings → Deploy keys |
| `CLOUDFLARE_API_TOKEN` | Account token with **Workers Scripts: Edit** and **D1: Edit** | Cloudflare → API tokens |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id | Cloudflare dashboard URL, or `npx wrangler whoami` |

Make sure `CONVEX_DEPLOY_KEY` is the go-tools key. A key for another Convex project
deploys to that project.

## Convex environment variables (set on the deployment)

Read them with `npx convex env list`. Read one value with `npx convex env get NAME`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GO_INVITE_CODE` | yes | Code needed to sign up. Without it anyone can sign up. Team join codes also work. |
| `EDGE_SYNC_SECRET` | for the edge | Shared secret for `/api/edge/*` and the edge's `/_sync`. Must match the Worker secret. |
| `EDGE_SYNC_URLS` | for the edge | Comma-separated edges Convex pokes on every change: `https://go-tools.go-tools.workers.dev` |
| `GO_EDGE_URL` | for the edge | Public edge URL the web app hands out in search URLs. |
| `LLM_API_KEY` | optional | Turns on plain-words queries (`? …`, `…!`, `my …`). Not set yet. |
| `LLM_PROVIDER` | optional | `anthropic` (default) or `openai` (any OpenAI-compatible API). |
| `LLM_MODEL` | optional | Default `claude-haiku-5-5` for Anthropic, `gpt-4o-mini` for OpenAI. |
| `LLM_BASE_URL` | optional | Override the API endpoint. |
| `LLM_TIMEOUT_MS` | optional | Default 2500. |

`CONVEX_CLOUD_URL` and `CONVEX_SITE_URL` are set by Convex itself.

## Cloudflare Worker settings

- `wrangler.toml`: `CONVEX_SITE` (the Convex site URL) and the `DB` binding to D1 `go-tools`.
- Secret `EDGE_SYNC_SECRET`, the same value as on Convex: `npx wrangler secret put EDGE_SYNC_SECRET`.
- D1 tables create themselves on the first sync. There is no migration step.

## Cloud Run settings (only if you use `deploy/gcp`)

- Container env: `CONVEX_SITE`, `EDGE_SYNC_SECRET`, plus optional `PORT` (8080) and `SYNC_CHECK_MS` (60000).
- Terraform vars in `deploy/gcp/terraform.tfvars` (gitignored): `project_id`, `convex_site`, `edge_sync_secret`, `regions`, `domain`.
- Add its URL to Convex `EDGE_SYNC_URLS` (`deploy/gcp/deploy.sh` does this).

## Local development

```bash
npm install
npm test                 # parser, templates, hashing
npm run typecheck

# Convex: a personal dev deployment (asks you to log in), or point at your own
npx convex dev           # keeps convex/ in sync as you edit

# Web app with hot reload (reads VITE_CONVEX_URL / VITE_CONVEX_SITE_URL from .env.local)
npm run dev:web

# Edge Worker against a local or dev Convex, with a local D1
printf 'EDGE_SYNC_SECRET=local-secret\n' > .dev.vars   # gitignored
npx convex env set EDGE_SYNC_SECRET local-secret
npx convex env set EDGE_SYNC_URLS http://127.0.0.1:8787  # only if Convex can reach your machine
npm run dev:edge         # wrangler dev on :8787

# Edge as a Node server (what Cloud Run runs)
CONVEX_SITE=<site url> EDGE_SYNC_SECRET=local-secret PORT=8090 npm run dev:node
```

To try a search locally, open `http://127.0.0.1:8787/s?q=gh+x&t=<search token>`.
The `Server-Timing` header shows how long the edge took.

## Deploying

```bash
npm run deploy:dev       # builds the web app into convex/lib/assets.ts, pushes to tame-crow-881
npm run deploy:edge      # wrangler deploy (needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
npx convex run seed:run  # re-seed built-in shortcuts after editing convex/seed.ts
```

The web app is embedded in `convex/lib/assets.ts`. Commit that file after `npm run build`
so a deploy from a fresh checkout serves the current UI.

## Rotating secrets

- **Sync secret:** pick a new one (`openssl rand -hex 24`). Set it on Convex (`npx convex env set EDGE_SYNC_SECRET …`) and on the Worker (`npx wrangler secret put EDGE_SYNC_SECRET`). Until both match, searches still work from the edge's copy, but edits don't reach it.
- **Cloudflare token / Convex deploy key:** revoke and recreate them in their dashboards. Nothing in the repo changes.
- **Invite code:** `npx convex env set GO_INVITE_CODE <new code>`.
