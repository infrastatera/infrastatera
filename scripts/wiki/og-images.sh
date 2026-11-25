#!/usr/bin/env bash
# Makes the share images (1200×630 PNG) that LinkedIn, Slack and search results show for wiki pages,
# one per illustration in assets/wiki/. Only missing ones are made: after changing an illustration,
# delete its PNG in assets/wiki/og/ so it is made again. (File dates aren't reliable after a git checkout.)
# Needs Google Chrome (installed on GitHub's ubuntu runners). Run from the repo root:
#   bash scripts/wiki/og-images.sh
set -euo pipefail
CHROME="${CHROME:-$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || true)}"
if [ -z "$CHROME" ]; then echo "Chrome not found; skipping share images."; exit 0; fi
mkdir -p assets/wiki/og
tmp="$(mktemp -d)"
made=0
for svg in assets/wiki/*.svg; do
  name="$(basename "$svg" .svg)"
  out="assets/wiki/og/$name.png"
  if [ -f "$out" ]; then continue; fi
  cat > "$tmp/$name.html" <<HTML
<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px;background:#FFFFFF;font-family:"Open Sans",Helvetica,Arial,sans-serif}
  .wrap{position:absolute;inset:24px 40px 64px;display:flex;align-items:center;justify-content:center}
  .wrap img{max-width:100%;max-height:100%}
  .bar{position:absolute;left:0;right:0;bottom:0;height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 40px;background:#15181B;color:#FFFFFF;font-size:18px;font-weight:600}
  .bar span{color:#B3B3B3;font-weight:400}
</style></head><body>
  <div class="wrap"><img src="file://$PWD/$svg" alt=""></div>
  <div class="bar">InfraStatera Wiki <span>infrastatera.com/wiki</span></div>
</body></html>
HTML
  "$CHROME" --headless=new --disable-gpu --no-sandbox --hide-scrollbars --allow-file-access-from-files \
    --window-size=1200,630 --screenshot="$PWD/$out" "file://$tmp/$name.html" >/dev/null 2>&1
  made=$((made + 1))
done
rm -rf "$tmp"
echo "Share images made: $made"
