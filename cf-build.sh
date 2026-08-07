#!/usr/bin/env bash
# Cloudflare Pages build step for project sss-app.
#
# Set in the Pages project (Settings → Builds & deployments):
#   Build command:            bash cf-build.sh
#   Build output directory:   _site
#
# Without this, the Git integration deploys the repo ROOT, which publishes
# *.LOCKED* snapshots and README.md at app.stuffsosweet.com. Keep the exclude
# list here in sync with deploy-cf.sh.
#
# Uses only coreutils — the Pages build image does not ship rsync.
set -euo pipefail
cd "$(dirname "$0")"

OUT=_site
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

# Copy the whole tree (including dotfiles), then prune what must not ship.
cp -a . "$STAGE/"

rm -rf \
  "$STAGE/.git" \
  "$STAGE/.github" \
  "$STAGE/.wrangler" \
  "$STAGE/$OUT"
rm -f \
  "$STAGE/.gitignore" \
  "$STAGE/README.md" \
  "$STAGE/deploy-cf.sh" \
  "$STAGE/cf-build.sh"

# Frozen page snapshots kept for reference — never ship them.
find "$STAGE" -name '*.LOCKED*' -exec rm -rf {} + 2>/dev/null || true

rm -rf "$OUT"
mkdir -p "$OUT"
cp -a "$STAGE"/. "$OUT"/

echo "Staged $(find "$OUT" -type f | wc -l | tr -d ' ') files into $OUT/"
echo "Top level: $(ls -A "$OUT" | tr '\n' ' ')"
