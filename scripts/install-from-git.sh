#!/usr/bin/env zsh
set -euo pipefail
SKILL_HOME="${SKILL_HOME:-$HOME/Documents/Cheese/ai/agent-skills}"
if [ $# -lt 3 ]; then
  echo "Usage: $0 <skill-name> <git-url> <subpath> [agents] [claude]"
  echo "Example: $0 foo https://github.com/org/repo.git skills/foo agents claude"
  exit 2
fi
skill="$1"; repo="$2"; subpath="$3"; shift 3
consumers=("$@")
if [ ${#consumers[@]} -eq 0 ]; then consumers=(agents claude); fi
tmp="$(mktemp -d)"
git clone "$repo" "$tmp/repo"
commit="$(git -C "$tmp/repo" rev-parse HEAD)"
mkdir -p "$SKILL_HOME/skills/$skill"
rsync -a --delete "$tmp/repo/$subpath/" "$SKILL_HOME/skills/$skill/"
for c in "${consumers[@]}"; do
  ln -sfn "../../skills/$skill" "$SKILL_HOME/views/$c/$skill"
done
cat <<EOF
Installed $skill from $repo at $commit.
Next:
  1. Add/update registry.yaml: source.url=$repo, source.subpath=$subpath, source.upstream_commit=$commit
  2. Run: $SKILL_HOME/scripts/doctor.sh
  3. git -C $SKILL_HOME diff
  4. git -C $SKILL_HOME add . && git -C $SKILL_HOME commit -m 'Install $skill'
EOF
