#!/bin/bash
# Builds the preview copy of the site into $SP/site: packed models, the game's textures, and page.html
# (the page file the Artifact tool wraps: no doctype/html/head/body).
set -e
SP=/tmp/rewild
ROOT=${ROOT:-/home/user/deekshitthvegiportfolio}
rm -rf $SP/site-build $SP/site
cd $ROOT && VITE_MODEL_PACKING=json npx vite build --base ./ --outDir $SP/site-build --emptyOutDir > $SP/site-build.log 2>&1
mkdir -p $SP/site
cp -r $SP/site-build/assets $SP/site/assets
cp $SP/site-build/THIRD_PARTY_NOTICES.md $SP/site/ 2>/dev/null || true
mkdir -p $SP/site/textures && cp -r $SP/site-build/textures/expedition $SP/site-build/textures/nasa $SP/site-build/textures/badges $SP/site-build/textures/crew $SP/site-build/textures/story $SP/site/textures/
cp -r $SP/site-build/cockpit $SP/site/cockpit
[ -d $SP/site-build/films ] && cp -r $SP/site-build/films $SP/site/films
cp $SP/site-build/models/expedition/ATTRIBUTION.md $SP/site/ATTRIBUTION-models.md 2>/dev/null || true
(cd $SP/hf/tools && node pack.mjs $ROOT/public/models/expedition $SP/site/models/expedition > $SP/pack.log)
CSS=$(grep -o 'assets/index-[^"]*\.css' $SP/site-build/index.html | head -1)
JS=$(grep -o 'assets/index-[^"]*\.js' $SP/site-build/index.html | head -1)
cat > $SP/site/page.html <<HTML
<title>Galactic Portfolio</title>
<style>
  /* The portfolio is one dark scene, so the frame is pinned to it and the host theme never shows through. */
  :root { color-scheme: dark; background: #020307; }
  body { background: #020307; color: #f8fafc; }
</style>
<link rel="stylesheet" href="./$CSS">
<div id="root">
  <div id="init-loader" style="position: fixed; inset: 0; display: grid; place-items: center; background: #020307; color: rgba(237, 243, 255, 0.62); font: 500 14px -apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, system-ui, sans-serif;">Loading…</div>
</div>
<script type="module" crossorigin src="./$JS"></script>
HTML
echo "css $CSS js $JS"; du -sh $SP/site; find $SP/site -type f | wc -l
