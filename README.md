# Skills Manager

**English** | [简体中文](README.zh-CN.md)

`skills-manager-cli` is a local-first CLI and dashboard for managing agent, Claude, and Codex skills from a registry-driven skill home.

## Quick Start

**No setup needed** — just run:

```sh
npx skills-manager-cli web
```

This automatically creates and initializes `~/.skills-manager/` on first run.

**Already have skills in `~/.claude/skills` or other agent runtimes?** Fold them in with `skills-manager init` — content moves into the hub, originals become symlinks (backed up first):

```sh
skills-manager init --dry-run   # preview
skills-manager init             # import
```

Or install globally:

```sh
npm install -g skills-manager-cli
# or
pnpm add -g skills-manager-cli
skills-manager web
```

👉 **[See Getting Started guide](docs/GETTING_STARTED.md)** for detailed instructions and common tasks.

## Install and Run

Use without installing globally:

```sh
npx skills-manager-cli web
```

Or install globally from a published package or packed tarball:

```sh
npm install -g skills-manager-cli
# or
pnpm add -g skills-manager-cli
skills-manager web
skills-manager doctor
```

`web` opens a local Vue/Fastify dashboard by default. Use `--no-open` to keep the browser closed.

## Skill home layout

A skill home contains:

- `skills/`: canonical skill directories, kept flat as `skills/<skill-name>/SKILL.md`
- `views/`: generated consumer symlink trees such as `views/agents/` and `views/claude/`
- `collections/`: generated category symlink trees
- `registry.yaml`: metadata, provenance, consumers, category, source, and update policy
- `.skills/activity.jsonl`: operation records written by the dashboard/CLI

Skill home resolution priority:

1. `--home <path>`
2. `SKILL_HOME`
3. current working directory when it already looks like a skill home
4. `~/.skills-manager`, initialized automatically

## Common commands

```sh
skills-manager web --home ~/.skills-manager
skills-manager doctor --home ~/.skills-manager
skills-manager list --home ~/.skills-manager
skills-manager add owner/repo --all --consumer agents --consumer claude --yes
skills-manager update --plan
skills-manager update --skill my-skill
skills-manager init --dry-run                    # preview runtime-skill import
skills-manager init --prefer claude-code hub     # this-run conflict priority
skills-manager init --resolve my-skill=cursor    # import with a conflict decision
skills-manager backup list                       # inspect init backups
skills-manager backup restore my-skill           # roll one import back
skills-manager edit my-skill --source-url https://github.com/owner/repo
skills-manager archive old-skill
```

Sources can be GitHub shorthand (`owner/repo`), Git URLs, GitHub tree URLs, or local paths.

## Development

```sh
pnpm install
pnpm run build
pnpm test
```

## Documentation

- **[Getting Started](docs/GETTING_STARTED.md)** — Installation, first launch, common tasks
- **[CLI Reference](docs/CLI.md)** — Full command reference and advanced usage
- **[Architecture](CONTEXT.md)** — Project structure and design decisions
