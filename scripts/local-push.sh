#!/usr/bin/env bash
# Push convex/ to the already-running local backend (dev only).
set -euo pipefail
cd "$(dirname "$0")/.."
KEY=$(python3 -c "import json;print(json.load(open('.convex/local/default/config.json'))['adminKey'])")
env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT -u CONVEX_AGENT_MODE CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210 CONVEX_SELF_HOSTED_ADMIN_KEY="$KEY" npx convex dev --once "$@"
