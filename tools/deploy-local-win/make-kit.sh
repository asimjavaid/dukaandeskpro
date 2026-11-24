#!/usr/bin/env bash
# Builds the deploy kit folder: this folder's files + a git archive of the committed Lite code.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(cd "$here/../.." && pwd)"
out="${1:-/workspace/dukaandesk-lite-deploy-kit}"
rm -rf "$out"; mkdir -p "$out"
cp "$here"/*.ps1 "$here"/*.cmd "$here"/*.mjs "$here"/TEST-GUIDE-LITE.md "$here"/README.md "$out"/
git -C "$repo" archive --format=zip -o "$out/dukaandesk-lite-src.zip" HEAD -- . ":(exclude)apps/web/public/bg-model"
python3 -c "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2])" "$(dirname "$out")/$(basename "$out")" "$out"
echo "$out ($(du -sh "$out" | cut -f1)), zip: $(dirname "$out")/$(basename "$out").zip"
