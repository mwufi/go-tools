#!/usr/bin/env bash
# Build the edge image with Cloud Build, apply Terraform, and point Convex at it.
# Usage: deploy/gcp/deploy.sh   (reads deploy/gcp/terraform.tfvars)
set -euo pipefail
cd "$(dirname "$0")"
PROJECT=$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' terraform.tfvars)
REGION=$(sed -n 's/^regions *= *\["\([^"]*\)".*/\1/p' terraform.tfvars); REGION=${REGION:-us-west2}
TAG=$(git rev-parse --short HEAD)
REPO="$REGION-docker.pkg.dev/$PROJECT/go-tools"

terraform init -input=false
# First run: the registry must exist before the image can be pushed.
terraform apply -input=false -auto-approve -target=google_artifact_registry_repository.images -var "image=$REPO/edge:$TAG"
(cd ../.. && gcloud builds submit --project "$PROJECT" --region "$REGION" \
  --config deploy/gcp/cloudbuild.yaml --substitutions "_IMAGE=$REPO/edge:$TAG" .)
terraform apply -input=false -auto-approve -var "image=$REPO/edge:$TAG"
EDGE=$(terraform output -raw edge_url)
(cd ../.. && npx convex env set GO_EDGE_URL "$EDGE")
echo "Edge is live at $EDGE. New search URL: $EDGE/s?q=%s&t=<your search token> (Settings shows it)."
