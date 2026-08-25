# Skills Manager

`@shenysun/skills-manager` is a local-first CLI and dashboard for managing agent, Claude, and Codex skills from a registry-driven skill home.

## Quick Start

**No setup needed** — just run:

```sh
npx @shenysun/skills-manager dashboard
```

This automatically creates and initializes `~/.skills-manager/` on first run.

**Already have skills in `~/.claude/skills` or other agent runtimes?** Fold them in with `skills-manager init` — content moves into the hub, originals become symlinks (backed up first):

```sh
skills-manager init --dry-run   # preview
skills-manager init             # import
```

Or install globally:

```sh
npm install -g @shenysun/skills-manager
skills-manager dashboard
```

👉 **[See Getting Started guide](docs/GETTING_STARTED.md)** for detailed instructions and common tasks.

## Install and Run

Use without installing globally:

```sh
npx @shenysun/skills-manager dashboard
```

Or install globally from a published package or packed tarball:

```sh
npm install -g @shenysun/skills-manager
skills-manager dashboard
skills-manager doctor
```

The dashboard opens a local Vue/Fastify control center by default. Use `--no-open` to keep the browser closed.

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
skills-manager dashboard --home ~/.skills-manager
skills-manager doctor --home ~/.skills-manager
skills-manager list --home ~/.skills-manager
skills-manager add owner/repo --all --consumer agents --consumer claude --yes
skills-manager update --plan
skills-manager update --skill my-skill
skills-manager init --dry-run                    # preview runtime-skill import
skills-manager init --resolve my-skill=cursor    # import with a conflict decision
skills-manager backup list                       # inspect init backups
skills-manager backup restore my-skill           # roll one import back
skills-manager edit my-skill --source-url https://github.com/owner/repo
skills-manager archive old-skill
```

Sources can be GitHub shorthand (`owner/repo`), Git URLs, GitHub tree URLs, or local paths.

## Development

```sh
npm install
npm run build
npm run smoke:core
npm run smoke:cli
npm run smoke:distribute
npm run smoke:init
npm run smoke:api
npm run smoke:package
```

## Documentation

- **[Getting Started](docs/GETTING_STARTED.md)** — Installation, first launch, common tasks
- **[CLI Reference](docs/CLI.md)** — Full command reference and advanced usage
- **[Architecture](CONTEXT.md)** — Project structure and design decisions
