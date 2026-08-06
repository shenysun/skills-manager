#!/usr/bin/env zsh
set -euo pipefail
SKILL_HOME="${SKILL_HOME:-$HOME/Documents/Cheese/ai/agent-skills}"
python3 - <<'PY'
import pathlib, re
root = pathlib.Path.home() / 'Documents/Cheese/ai/agent-skills'
reg = root / 'registry.yaml'
if not reg.exists():
    raise SystemExit('registry.yaml not found')
for view in ['agents', 'claude']:
    d = root / 'views' / view
    d.mkdir(parents=True, exist_ok=True)
    for child in list(d.iterdir()):
        if child.is_symlink() or child.is_file():
            child.unlink()
        elif child.is_dir():
            raise SystemExit(f'Refusing to remove real directory in view: {child}. Run adopt-installed.sh first.')
text = reg.read_text()
entries = {}
current = None
in_consumers = False
for line in text.splitlines():
    m = re.match(r'  ([A-Za-z0-9_.-]+):$', line)
    if m:
        current = m.group(1)
        entries[current] = []
        in_consumers = False
        continue
    if current and line == '    consumers:':
        in_consumers = True
        continue
    if current and in_consumers:
        m = re.match(r'      - (agents|claude)$', line)
        if m:
            entries[current].append(m.group(1))
        elif line.startswith('    ') and not line.startswith('      '):
            in_consumers = False
for name, consumers in entries.items():
    if not (root / 'skills' / name / 'SKILL.md').exists():
        continue
    for consumer in consumers:
        link = root / 'views' / consumer / name
        link.symlink_to(pathlib.Path('../../skills') / name)
print(f'Rebuilt views for {len(entries)} registry entries')
PY
