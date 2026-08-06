#!/usr/bin/env zsh
set -euo pipefail
SKILL_HOME="${SKILL_HOME:-$HOME/Documents/Cheese/ai/agent-skills}"

echo "Skill home: $SKILL_HOME"

if [ ! -d "$SKILL_HOME" ]; then
  echo "ERROR: SKILL_HOME does not exist"
  exit 1
fi

echo
echo "Canonical skills with SKILL.md:"
find "$SKILL_HOME/skills" -maxdepth 2 -name SKILL.md | wc -l | tr -d ' '
echo

echo
echo "Directories under skills/ without SKILL.md:"
find "$SKILL_HOME/skills" -maxdepth 1 -mindepth 1 -type d | while read -r d; do
  base="$(basename "$d")"
  case "$base" in .*) continue ;; esac
  if [ ! -f "$d/SKILL.md" ]; then
    echo "  $base"
  fi
done

echo
echo "Broken symlinks in views/ and collections/:"
find "$SKILL_HOME/views" "$SKILL_HOME/collections" -type l ! -exec test -e {} \; -print 2>/dev/null || true

echo
echo "Live entry points:"
for p in "$HOME/.agents/skills" "$HOME/.claude/skills"; do
  if [ -L "$p" ]; then
    echo "  OK symlink: $p -> $(readlink "$p")"
  elif [ -d "$p" ]; then
    echo "  NOT YET SWITCHED: $p is a real directory"
  else
    echo "  MISSING: $p"
  fi
done

echo
echo "Git status:"
git -C "$SKILL_HOME" status --short
