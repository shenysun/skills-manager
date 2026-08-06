# Agent Skills

Central source of truth for local agent and Claude skills.

## Layout

- `skills/`: canonical skill source directories. Keep this flat: `skills/<skill-name>/SKILL.md`.
- `views/agents/`: symlink view exposed as `~/.agents/skills`.
- `views/claude/`: symlink view exposed as `~/.claude/skills`.
- `collections/`: browsing-only functional groupings, also symlinks.
- `registry.yaml`: provenance, consumers, category, and update policy.
- `scripts/`: install, update, adopt, rebuild, and doctor helpers.

## Daily rule

Install or update into `skills/`, expose through `views/`, record metadata in `registry.yaml`, then commit.

## Common commands

```zsh
export SKILL_HOME="$HOME/Documents/Cheese/ai/agent-skills"
"$SKILL_HOME/scripts/doctor.sh"
"$SKILL_HOME/scripts/rebuild-views.sh"
```

## CLI

日常操作推荐使用 TypeScript/Inquirer CLI：

```zsh
export SKILL_HOME="$HOME/Documents/Cheese/ai/agent-skills"
"$SKILL_HOME/bin/skills" menu
"$SKILL_HOME/bin/skills" doctor
"$SKILL_HOME/bin/skills" add owner/repo --list
```

完整命令见 `docs/CLI.md`。
