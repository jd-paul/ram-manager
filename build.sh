#!/bin/bash
# Package RAM Manager for the Chrome Web Store.
# Uses an explicit file list + pre-flight checks because a past hand-rolled
# zip silently dropped suspended/ and shipped a broken frozen page to users.
set -euo pipefail

cd "$(dirname "$0")"

VERSION=$(grep -m1 '"version"' manifest.json | sed -E 's/.*"version": *"([^"]+)".*/\1/')
OUT="ram-manager-v${VERSION}.zip"

# Everything the extension loads at runtime. Keep in sync with manifest.json
# and page <link>/<script> refs — the check below validates the critical ones.
REQUIRED=(
  manifest.json
  background.js
  suspended.html
  suspended/suspended.css
  suspended/suspended.js
  onboarding.html
  css/base.css
  js/content.js
  js/smarts.js
  js/suspension.js
  js/tabs.js
  js/storage.js
  js/utils.js
  js/history.js
  js/memory.js
  js/theme.js
  js/theme-fouc.js
  js/settings-ui.js
  js/tablist.js
)

for f in "${REQUIRED[@]}"; do
  if [ ! -f "$f" ]; then
    echo "build.sh: required file missing: $f" >&2
    exit 1
  fi
done

if command -v node >/dev/null 2>&1; then
  node audit-assets.cjs . || { echo "build.sh: asset audit failed" >&2; exit 1; }
else
  echo "build.sh: node not found — skipping asset audit (install node to enable the gate)" >&2
fi

rm -f "$OUT"
zip -r "$OUT" \
  manifest.json background.js suspended.html onboarding.html \
  suspended onboarding popup dashboard settings js css \
  themes snippets icons images \
  -x '*.DS_Store'

echo "built $OUT"
unzip -l "$OUT" | grep -c 'suspended/suspended.js' >/dev/null && echo "verified: suspended/ packaged"
