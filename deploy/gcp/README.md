# go-tools on GCP (Cloud Run)

The edge server (`server/node.ts`, same handler as the Cloudflare Worker in
`edge/handler.ts`) on Cloud Run, nearest region first. Convex stays the source of truth.

Day one: one region (`us-west2`, Los Angeles) on its `run.app` URL. Later: set
`domain` and add regions; Terraform then builds a global HTTPS load balancer with
serverless NEGs so each person is served by the nearest region.

```bash
cp deploy/gcp/terraform.tfvars.example deploy/gcp/terraform.tfvars   # fill in project_id
gcloud auth application-default login
deploy/gcp/deploy.sh        # build image (Cloud Build), terraform apply, set GO_EDGE_URL in Convex
```

Then copy the new search URL from Settings → Browser.

Files: `main.tf` (APIs, Artifact Registry, service account, Cloud Run per region),
`lb.tf` (optional global load balancer, only with a domain), `cloudbuild.yaml`, `deploy.sh`.
