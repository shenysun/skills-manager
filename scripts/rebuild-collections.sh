#!/usr/bin/env zsh
set -euo pipefail
SKILL_HOME="${SKILL_HOME:-$HOME/Documents/Cheese/ai/agent-skills}"
python3 - <<'PY'
import pathlib, re
root = pathlib.Path.home() / 'Documents/Cheese/ai/agent-skills'
collections = root / 'collections'
collections.mkdir(exist_ok=True)
for cat_dir in list(collections.iterdir()):
    if cat_dir.is_symlink() or cat_dir.is_file():
        cat_dir.unlink()
    elif cat_dir.is_dir():
        for child in list(cat_dir.iterdir()):
            if child.is_symlink() or child.is_file():
                child.unlink()
            elif child.is_dir():
                raise SystemExit(f'Refusing to remove real directory in collections: {child}')
text = (root / 'registry.yaml').read_text()
current = None
category = None
entries = []
for line in text.splitlines():
    m = re.match(r'  ([A-Za-z0-9_.-]+):$', line)
    if m:
        if current and category:
            entries.append((current, category))
        current = m.group(1)
        category = None
        continue
    if current:
        m = re.match(r'    category: ([A-Za-z0-9_.-]+)$', line)
        if m:
            category = m.group(1)
if current and category:
    entries.append((current, category))
for name, cat in entries:
    if not (root / 'skills' / name / 'SKILL.md').exists():
        continue
    d = collections / cat
    d.mkdir(exist_ok=True)
    link = d / name
    if not link.exists() and not link.is_symlink():
        link.symlink_to(pathlib.Path('../../skills') / name)
print(f'Rebuilt {len(entries)} collection links')
PY
