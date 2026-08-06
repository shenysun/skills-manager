# Skills Manager

`@shenysun/skills-manager` is a local-first CLI and dashboard for managing agent, Claude, and Codex skills from a registry-driven skill home.

## Install and run

Use without installing globally:

```sh
npx @shenysun/skills-manager dashboard --home ~/.skills-manager
```

Or install globally from a published package or packed tarball:

```sh
npm install -g @shenysun/skills-manager
skills-manager dashboard --home ~/.skills-manager
skills-manager doctor --home ~/.skills-manager
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
skills-manager expose agents my-skill
skills-manager hide claude my-skill
skills-manager archive old-skill
```

Sources can be GitHub shorthand (`owner/repo`), Git URLs, GitHub tree URLs, or local paths.

## Development

```sh
npm install
npm run build
npm run smoke:core
npm run smoke:cli
npm run smoke:api
npm run smoke:package
```

See [`docs/CLI.md`](docs/CLI.md) for the full command reference and publish smoke-test workflow.
