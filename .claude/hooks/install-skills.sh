#!/usr/bin/env bash
# Install the vetted Claude Code skills into ~/.claude/skills (selection of 30 Oct 2026).
# Each repo is fetched at a pinned commit; only the chosen skill folders are copied, with
# their licence files. Safe to re-run: existing copies are replaced. Run by session-start.sh.
set -euo pipefail

DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$DEST"

fetch() { # owner/repo commit [only these paths...] -> checkout dir
    local dir="$WORK/${1//\//_}" repo="$1" commit="$2"; shift 2
    git init -q "$dir"
    git -C "$dir" remote add origin "https://github.com/$repo.git"
    GIT_LFS_SKIP_SMUDGE=1 git -C "$dir" fetch -q --depth 1 --filter=blob:none origin "$commit"
    if [ $# -gt 0 ]; then git -C "$dir" sparse-checkout set --no-cone "$@" >/dev/null; fi
    GIT_LFS_SKIP_SMUDGE=1 git -C "$dir" checkout -q FETCH_HEAD
    echo "$dir"
}

put() { # source-dir skill-name [licence files...]
    local src="$1" name="$2"; shift 2
    rm -rf "${DEST:?}/$name"
    cp -r "$src" "$DEST/$name"
    for f in "$@"; do cp "$f" "$DEST/$name/"; done
}

R=$(fetch multica-ai/andrej-karpathy-skills 2c606141936f1eeef17fa3043a72095b4765b9c2)
put "$R/skills/karpathy-guidelines" karpathy-guidelines

R=$(fetch kajisho5/ffmpeg-skill 8b6c30528d70b262d8211c6ad0cf88b0de93d8c2)
rm -rf "${DEST:?}/ffmpeg-skill"; mkdir -p "$DEST/ffmpeg-skill"
cp -r "$R"/{SKILL.md,LICENSE,scripts,references,templates} "$DEST/ffmpeg-skill/"

R=$(fetch cathrynlavery/diagram-design 0cf73c3fcc56667ad91a9a04c439ac6ccfabc9d1)
put "$R/skills/diagram-design" diagram-design "$R/LICENSE" "$R/THIRD_PARTY_LICENSES.md"

R=$(fetch hugohe3/ppt-master 5e8856be0da8e6bc85c4aa28acc614478f7b7137)
put "$R/skills/ppt-master" ppt-master   # whole folder: it checks its own integrity

R=$(fetch gamedev-skills/awesome-gamedev-agent-skills 19d93f97c9c1ea0f8b306e77aa81e0d3e352d3e9)
for s in web-engines/threejs-scene-setup web-engines/threejs-materials-lighting web-engines/threejs-gltf-loading \
         disciplines/shader-programming disciplines/performance-optimization disciplines/procedural-gen \
         disciplines/camera-systems disciplines/game-feel disciplines/game-ui-ux disciplines/physics-tuning \
         disciplines/audio-design disciplines/save-systems disciplines/dialogue-systems disciplines/input-systems \
         disciplines/level-design disciplines/create-game-assets genres/survival-crafting \
         disciplines/game-ai disciplines/ai-behavior-trees-utility-ai genres/rpg \
         workflows/steam-publish workflows/itch-publish; do
    put "$R/skills/$s" "$(basename "$s")" "$R/LICENSE" "$R/NOTICE"
done

R=$(fetch mattpocock/skills a496f5513d4a4cf889bc48e189e579f4b0bdf6aa)
for s in engineering/diagnosing-bugs engineering/tdd engineering/codebase-design engineering/prototype \
         productivity/grilling productivity/grill-me productivity/wait-what productivity/writing-for-agents; do
    put "$R/skills/$s" "$(basename "$s")" "$R/LICENSE"
done

R=$(fetch affaan-m/ecc b38be6a7f6350964d59328b52f0624e1d1d552d1)
for n in react-patterns react-performance typescript-patterns vite-patterns verification-loop \
         make-interfaces-feel-better frontend-a11y; do
    put "$R/skills/$n" "$n" "$R/LICENSE"
done
mkdir -p "$DEST/react-patterns/rules" "$DEST/typescript-patterns/rules"
cp -r "$R/rules/react" "$DEST/react-patterns/rules/"
cp -r "$R/rules/typescript" "$DEST/typescript-patterns/rules/"
sed -i 's#\.\./\.\./rules/react/#rules/react/#g' "$DEST/react-patterns/SKILL.md"
sed -i 's#`rules/typescript/coding-style.md` and `rules/typescript/patterns.md` in this repository, installed as `rules/ecc/typescript/coding-style.md` and `rules/ecc/typescript/patterns.md`#`rules/typescript/coding-style.md` and `rules/typescript/patterns.md` next to this file#; s#(`rules/typescript/`, installed as `rules/ecc/typescript/`)#(`rules/typescript/` next to this file)#' "$DEST/typescript-patterns/SKILL.md"

# unslop (UI): turns AI-looking screens into designed ones. CC BY 4.0, keep the credit.
R=$(fetch heydamir/unslop 4652254daff586ff4739849395a127b56f7f8cc7)
put "$R/skills/unslop" unslop "$R/LICENSE"

# Anti-slop writing skills from @juampitech's list (30 Oct 2026). Two names clash with
# others, so Cursor's unslop becomes unslop-writing and Aboudjem's humanizer becomes humanizer-aboudjem.
R=$(fetch hardikpandya/stop-slop 8da1f030185bdfe8471220585162991eaeb970e9)
rm -rf "${DEST:?}/stop-slop"; mkdir -p "$DEST/stop-slop"; cp -r "$R"/{SKILL.md,LICENSE,references} "$DEST/stop-slop/"
R=$(fetch petergyang/no-ai-slop 000650b156983f5159695b441477f4e63b25dc85)
put "$R/skills/no-ai-slop" no-ai-slop "$R/LICENSE"
R=$(fetch blader/humanizer 0ef9fe5bc3572734fd3ae6c448fe00a30cd5dcf0)
rm -rf "${DEST:?}/humanizer"; mkdir -p "$DEST/humanizer"; cp "$R"/{SKILL.md,LICENSE} "$DEST/humanizer/"
R=$(fetch cursor/plugins 4dd1d05818d19792e7cd6e818f1667f95f7e1dbe '/pstack/skills/unslop/*' '/pstack/LICENSE')
put "$R/pstack/skills/unslop" unslop-writing "$R/pstack/LICENSE"
sed -i '0,/^name: unslop$/s//name: unslop-writing/' "$DEST/unslop-writing/SKILL.md"
R=$(fetch ehmo/slopkit b33718bb9283c11b09567dc714f92d90ffb7bd16 '/skills/slopbeth/*' '/LICENSE')
put "$R/skills/slopbeth" slopbeth "$R/LICENSE"
R=$(fetch Aboudjem/humanizer-skill a58df065367550b6ce40ff3f648335018d8e0589)
put "$R/skills/humanizer" humanizer-aboudjem "$R/LICENSE"
sed -i '0,/^name: humanizer$/s//name: humanizer-aboudjem/' "$DEST/humanizer-aboudjem/SKILL.md"
R=$(fetch stephenturner/skills 48287d806e61534bc14939b55b72c3f3f11a7db5)
put "$R/deslop" deslop "$R/LICENSE"
R=$(fetch elithrar/dotfiles eb4f994e0c1ebe1199f032f4e5fe1633d1b8067c '/.agents/skills/anti-slop/*' '/LICENSE')
put "$R/.agents/skills/anti-slop" anti-slop "$R/LICENSE"
R=$(fetch aashaexo/soundshuman a45cfbba9fde843d670e553a0aa98f6a23d7fb28)
rm -rf "${DEST:?}/humanize"; mkdir -p "$DEST/humanize"; cp -r "$R"/{SKILL.md,LICENSE,references,bin,package.json} "$DEST/humanize/"
R=$(fetch jalaalrd/anti-ai-slop-writing 63255f9bbb75a265dc5786a04535cd033f487756)
put "$R/skills/anti-ai-slop-writing" anti-ai-slop-writing

# Appllama (MIT): native mobile app screen design, and the guide to their hosted MCP
# (that skill only applies once the user connects mcp.appllama.io themselves).
R=$(fetch Appllama/appllama-skills dd5caaec3d5d50ad7fc0324da238119c6b7c3707)
for n in appllama-app-design-skill appllama-usage; do put "$R/skills/$n" "$n" "$R/LICENSE"; done

# teardown (MIT): interactive 3D simulators of real machines, recorded to video. Its own libraries come
# from npm; the browser is the one the cloud container already has (CHROMIUM, set by session-start.sh).
R=$(fetch elvarofficial/teardown e7e668cd44f48ba79a3c575e9f55c7e194d26eef)
rm -rf "${DEST:?}/teardown"; mkdir -p "$DEST/teardown"
(cd "$R" && git archive HEAD | tar -x -C "$DEST/teardown")
(cd "$DEST/teardown" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund --silent) || echo "warning: teardown libraries not installed"

# UI/UX Pro Max (MIT, offline): searchable style, colour, type and UX rule tables with a design-system
# generator. Only the two design skills; its logo/banner/brand skills call paid image APIs. The
# project's own UI rules (CLAUDE.md: Liquid Glass, Inter, one accent) win over its suggestions.
R=$(fetch nextlevelbuilder/ui-ux-pro-max-skill 4f2dbb67e64969a9a30ab00742f2d55d66ddec2b '/.claude/skills/ui-ux-pro-max/*' '/.claude/skills/design-system/*' '/LICENSE')
for n in ui-ux-pro-max design-system; do
    put "$R/.claude/skills/$n" "$n" "$R/LICENSE"
    sed -i "s#\${CLAUDE_PLUGIN_ROOT}/\.claude/skills/#$DEST/#g" "$DEST/$n/SKILL.md"
done

# cutaway (MIT): a three.js model built from one reference image that takes itself apart on camera,
# filmed at 60 fps with a synced score. Uses the container's Chromium, like teardown.
R=$(fetch Nyxera0x/cutaway 5d8f1c6efe0ed65a8fc7647a7a2a3ee9fbb4d20a)
rm -rf "${DEST:?}/cutaway"; mkdir -p "$DEST/cutaway"
(cd "$R" && git archive HEAD | tar -x -C "$DEST/cutaway")
(cd "$DEST/cutaway" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-audit --no-fund --silent) || echo "warning: cutaway libraries not installed"

# ppt-master's core Python libraries (its optional AI-image/TTS/web routes need more; add on demand).
python3 -m pip install --quiet "PyYAML>=6.0" "python-pptx>=0.6.21" "XlsxWriter>=3.0.0" "skia-pathops>=0.9.2" \
    "uharfbuzz>=0.50.0" "openpyxl>=3.1.0" "numpy>=1.20.0" || echo "warning: ppt-master libraries not installed"
python3 -c 'from PIL import Image' 2>/dev/null || python3 -m pip install --quiet --ignore-installed "Pillow>=9.0.0" || true

echo "Installed $(ls "$DEST" | wc -l) entries in $DEST"
