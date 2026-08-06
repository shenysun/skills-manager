#!/usr/bin/env zsh
set -euo pipefail
SKILL_HOME="${SKILL_HOME:-$HOME/Documents/Cheese/ai/agent-skills}"
if [ $# -lt 2 ]; then
  echo "Usage: $0 <agents|claude> <skill-name> [also-consumer...]"
  echo "Example: $0 agents new-skill claude"
  exit 2
fi
from_view="$1"
skill="$2"
shift 2
src="$SKILL_HOME/views/$from_view/$skill"
dst="$SKILL_HOME/skills/$skill"
if [ ! -d "$src" ] || [ -L "$src" ]; then
  echo "ERROR: $src must be a real directory installed into a view"
  exit 1
fi
if [ -e "$dst" ]; then
  echo "ERROR: canonical destination already exists: $dst"
  exit 1
fi
mv "$src" "$dst"
ln -sfn "../../skills/$skill" "$SKILL_HOME/views/$from_view/$skill"
for c in "$@"; do
  ln -sfn "../../skills/$skill" "$SKILL_HOME/views/$c/$skill"
done
cat <<EOF
Adopted $skill into $dst.
Next:
  1. Add it to $SKILL_HOME/registry.yaml
  2. Run: $SKILL_HOME/scripts/doctor.sh
  3. Commit changes in $SKILL_HOME
EOF
