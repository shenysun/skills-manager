#!/usr/bin/env zsh
set -euo pipefail
SKILL_HOME="${SKILL_HOME:-$HOME/Documents/Cheese/ai/agent-skills}"
if [ $# -lt 3 ]; then
  echo "Usage: $0 <skill-name> <git-url> <subpath>"
  exit 2
fi
skill="$1"; repo="$2"; subpath="$3"
if [ ! -d "$SKILL_HOME/skills/$skill" ]; then
  echo "ERROR: skill does not exist: $SKILL_HOME/skills/$skill"
  exit 1
fi
tmp="$(mktemp -d)"
git clone "$repo" "$tmp/repo"
commit="$(git -C "$tmp/repo" rev-parse HEAD)"
rsync -a --delete "$tmp/repo/$subpath/" "$SKILL_HOME/skills/$skill/"
cat <<EOF
Updated $skill from $repo at $commit.
Next:
  1. Update registry.yaml source.upstream_commit=$commit
  2. Run: $SKILL_HOME/scripts/doctor.sh
  3. Review: git -C $SKILL_HOME diff -- skills/$skill registry.yaml
  4. Commit if OK.
EOF
