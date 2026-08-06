#!/usr/bin/env bash
# Deploy static site to Cloudflare Pages (project: sss-app).
# Usage: ./deploy-cf.sh
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="sss-app"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

rsync -a \
  --exclude='.git' \
  --exclude='*.LOCKED*' \
  --exclude='.gitignore' \
  --exclude='deploy-cf.sh' \
  --exclude='README.md' \
  ./ "$STAGE/"

COMMIT_HASH=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
COMMIT_MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "manual deploy")

npx wrangler pages deploy "$STAGE" \
  --project-name="$PROJECT" \
  --branch=main \
  --commit-hash="$COMMIT_HASH" \
  --commit-message="$COMMIT_MSG"

echo ""
echo "Production: https://sss-app-aaz.pages.dev"
echo "Dashboard:  https://dash.cloudflare.com → Workers & Pages → sss-app"
