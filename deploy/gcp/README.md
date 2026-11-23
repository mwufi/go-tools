# go-tools on GCP (Cloud Run)

The edge server (`server/node.ts`, same handler as the Cloudflare Worker in
`edge/handler.ts`) on Cloud Run, nearest region first. Convex stays the source of truth.

Day one: one region (`us-west2`, Los Angeles) on its `run.app` URL. Later: set
`domain` and add regions; Terraform then builds a global HTTPS load balancer with
serverless NEGs so each person is served by the nearest region.

Each instance keeps the shortcuts in memory: a full copy from Convex at startup, then
just the changes whenever Convex pushes (`POST /_sync`). `max_instances` defaults to 1
because a push reaches one instance; extra instances catch up on their next search
within `SYNC_CHECK_MS` (60 s).

```bash
cp deploy/gcp/terraform.tfvars.example deploy/gcp/terraform.tfvars   # project_id, edge_sync_secret
npx convex env set EDGE_SYNC_SECRET <same secret>
gcloud auth application-default login
deploy/gcp/deploy.sh        # build image, terraform apply, set GO_EDGE_URL + EDGE_SYNC_URLS in Convex
```

Then copy the new search URL from Settings → Browser.

Files: `main.tf` (APIs, Artifact Registry, service account, Cloud Run per region),
`lb.tf` (optional global load balancer, only with a domain), `cloudbuild.yaml`, `deploy.sh`.
