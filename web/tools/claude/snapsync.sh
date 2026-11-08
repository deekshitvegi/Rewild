#!/bin/bash
# Make the test snapshot match the repo's working tree: same commit, plus uncommitted edits and new files.
set -e
M=/home/user/deekshitthvegiportfolio; S=/tmp/rewild/snap
cd $S && git checkout -q -f --detach $(git -C $M rev-parse HEAD) && git clean -qfd -e node_modules
git -C $M diff HEAD --binary > /tmp/rewild/snap.diff; [ -s /tmp/rewild/snap.diff ] && git apply /tmp/rewild/snap.diff
(cd $M && git ls-files --others --exclude-standard -z | xargs -0 -r cp --parents -t $S)
echo "synced $(git -C $S rev-parse --short HEAD)"
