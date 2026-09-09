# Skills Manager

**English** | [简体中文](README.zh-CN.md)

Manage your agent skills **from the conversation**: one `npx` command installs the manager skill, and from then on you just ask your agent — install, import, distribute, update, backfill provenance. Works with any skill-loading agent (Claude Code, Codex, Cursor, …).

## Quick Start

```sh
npx skills-manager-cli
```

That is the whole setup. Bootstrap creates the skill hub (`~/.skills-manager`), installs the **manager skill** into it from the bundled copy, and mounts it (symlink) into the agents it detects on your machine — you confirm the list in the one prompt it shows.

Then go back to your agent and say:

> **帮我看看我的 skills：有哪些、装到哪些 agent 了、有没有能更新的**
> (“Take stock of my skills: what I have, which agents they are wired into, and what has updates”)

**Already have skills in `~/.claude/skills` or other agent runtimes?** Don't migrate during setup — just ask your agent:

> 帮我把现有的 skills 导入 skills-manager 并整理好来源

Content moves into the hub, originals become symlinks (backed up first). Prefer to preview it yourself first? `skills-manager init --dry-run`.

## How it works

```text
~/.skills-manager                        ← hub: the only content authority
     skills/<name>/  ·  registry.yaml
          │
          │  distribute (symlink / copy)
          ▼
~/.claude/skills   ~/.cursor/skills   …  ← agent runtime dirs
          ▲
          │  drives, via `npx skills-manager-cli …`
   your agent  ⇄  the manager skill
```

- The **manager skill** is the primary interface ([ADR-0014](docs/adr/0014-manager-skill-first-bootstrap.md)): the npx bootstrap installs it and nothing else; every management action afterwards happens through it, in agent conversation. No agent detected yet? Bootstrap still creates the hub and tells you how to mount later.
- It keeps itself current: every CLI run compares the bundled copy with the hub copy and silently refreshes it — unless you edited the hub copy yourself, in which case it is yours and stays untouched.
- The CLI underneath is a plain engine (JSON output, non-interactive flags) — see the [CLI reference](docs/CLI.md).

## Skill home layout

A skill home contains:

- `skills/`: canonical skill directories, kept flat as `skills/<skill-name>/SKILL.md`
- `collections/`: generated category symlink trees (browse-only)
- `registry.yaml`: metadata — category, tags, consumers, source (repo, subpath, ref, baseline), update policy
- `.skills/`: distribution index (`distributions.jsonl`), activity log, optional agent-catalog override
- `.backups/`: pre-init originals, kept for 30 days

Skill home resolution priority:

1. `--home <path>`
2. `SKILL_HOME`
3. current working directory when it already looks like a skill home
4. `~/.skills-manager` — created by bootstrap only; other commands point you at it instead of creating it

## Common commands

```sh
npx skills-manager-cli                            # bootstrap (default when no subcommand)
skills-manager bootstrap --agent claude-code      # scripted bootstrap / mount later
skills-manager doctor
skills-manager list
skills-manager add owner/repo --all --yes
skills-manager distribute --to user --skill my-skill --agent claude-code
skills-manager update --plan
skills-manager update --skill my-skill
skills-manager init --dry-run                    # preview runtime-skill import
skills-manager init --prefer claude-code hub     # this-run conflict priority
skills-manager init --resolve my-skill=cursor    # import with a conflict decision
skills-manager backup list                       # inspect init backups
skills-manager backup restore my-skill           # roll one import back
skills-manager edit my-skill --source-git owner/repo --subpath skills/my-skill
skills-manager provenance list                   # skills still missing a source
skills-manager provenance adopt                  # backfill lockfile evidence
skills-manager archive old-skill
```

Sources can be GitHub shorthand (`owner/repo`), Git URLs, GitHub tree URLs, or local paths.

## Optional: global install & dashboard

Prefer typing a bare command? Install globally:

```sh
npm install -g skills-manager-cli   # or pnpm add -g skills-manager-cli
```

Prefer a visual interface? The local dashboard is an optional alternative to the conversation:

```sh
skills-manager web          # http://127.0.0.1:4777, --no-open to skip the browser
```

It offers the same library on one page: browse, install, update, and distribute. It never creates the hub — run bootstrap first.

## Development

```sh
pnpm install
pnpm run build
pnpm test
```

## Documentation

- **[Getting Started](docs/GETTING_STARTED.md)** — First run, importing existing skills, common tasks
- **[CLI Reference](docs/CLI.md)** — Full command reference and advanced usage
- **[Architecture](CONTEXT.md)** — Project structure and design decisions
