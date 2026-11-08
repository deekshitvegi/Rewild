#!/bin/bash
# Cloud sessions start in a fresh container, so give each one the vetted skills
# (see install-skills.sh). Local machines keep whatever skills their owner installed.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

skills="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
hashes="$skills/.install-skills.sha256"
# Skip when this exact script already installed them (the hash lives inside the skills folder).
if ! (cd .claude/hooks && sha256sum --check --status "$hashes") 2>/dev/null; then
  rm -f "$hashes"
  bash .claude/hooks/install-skills.sh >&2
  (cd .claude/hooks && sha256sum install-skills.sh) > "$hashes"
fi

# teardown records with the container's own Chromium rather than downloading another.
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -x /opt/pw-browsers/chromium ]; then
  echo 'export CHROMIUM=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi
