#!/bin/sh
# sh fetch.sh <work dir>
# Downloads the motion sources into <work dir>: Quaternius's Universal Animation Library (standard,
# CC0) and, from the CMU motion capture database in BVH, only the takes clips.py uses (the whole
# database is gigabytes). Commits as used on 7 Nov 2026 (checked; a newer HEAD is reported).
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
W=$1
[ -n "$W" ] || { echo "usage: sh fetch.sh <work dir>"; exit 1; }
mkdir -p "$W"
UAL_COMMIT=e24c23cf2a1323488a3faa226ea7ea21f644b73e
CMU_COMMIT=09a07f54f3bbb58797325f009282d0b2048a2871

[ -d "$W/ual-repo" ] || git clone --filter=blob:none --no-checkout https://github.com/J-Ponzo/gltf-universal-animation-library "$W/ual-repo"
git -C "$W/ual-repo" checkout -q "$UAL_COMMIT" -- LICENSE README.md glTF
ln -sfn ual-repo/glTF "$W/ual"

[ -d "$W/cmu-repo" ] || git clone --filter=blob:none --no-checkout https://github.com/una-dinosauria/cmu-mocap "$W/cmu-repo"
FILES=$(cd "$HERE" && python3 -c "from clips import CLIPS; print(' '.join(sorted({'data/' + c['file'] for c in CLIPS if c['src'] == 'cmu'})))")
git -C "$W/cmu-repo" -c gc.auto=0 checkout -q "$CMU_COMMIT" -- READMEFIRST.txt cmu-mocap-index-text.txt $FILES
ln -sfn cmu-repo/data "$W/cmu"
echo "fetched into $W: ual/ and cmu/ ($(echo $FILES | wc -w) takes)"
