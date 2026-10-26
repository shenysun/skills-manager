# Skills Manager

[![npm](https://img.shields.io/npm/v/skills-manager-cli?color=cb3837)](https://www.npmjs.com/package/skills-manager-cli)
[![npm downloads](https://img.shields.io/npm/dm/skills-manager-cli)](https://www.npmjs.com/package/skills-manager-cli)
[![GitHub stars](https://img.shields.io/github/stars/shenysun/skills-manager?style=social)](https://github.com/shenysun/skills-manager/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/node/v/skills-manager-cli)](https://nodejs.org)

**English** | [简体中文](README.zh-CN.md)


Manage your agent skills **from the conversation**: one `npx` command installs the manager skill, and from then on you just ask your agent — install, import, distribute, update, backfill provenance. Works with any skill-loading agent (Claude Code, Codex, Cursor, …).

> **CLI-first, conversation-driven.** This is `skills-manager-cli` — a terminal/npm tool with an optional local web dashboard. It is not a desktop app; if you were looking for the desktop application of the same name, that is a different project ([xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager)).

**What makes it different:**

- **One hub, every agent** — a single content library (`~/.skills-manager`) distributes any subset to any of the 70+ catalog agents, symlink or copy per target, with stale-copy detection and rollback.
- **Five source types** — git repos and URLs, direct download URLs (SKILL.md / zip / tar), local zip archives, Claude plugin marketplaces, and well-known discovery indexes.
- **Updates that don't cry wolf** — the update anchor is the git tree SHA of the skill's own subdirectory, so upstream commits outside the skill never light up an update.
- **The resident-cost ledger** — every distributed skill's frontmatter charges each message; `skills-manager cost` accounts it per runtime path (approximate, `≈`) with report-only recall suggestions. Undistributed = zero. See [ADR-0018](docs/adr/0018-resident-cost-ledger.md).
- **Provenance backfill** — imported skills without a source get one through lockfile-evidence adoption, agent-driven search, and your approval.
- **The manager skill** — every management action happens in agent conversation ([ADR-0014](docs/adr/0014-manager-skill-first-bootstrap.md)); the CLI underneath is a plain JSON engine.


## Why this instead of `gh skill` / `npx skills` / the desktop app?

| | **skills-manager** | `gh skill` | `npx skills` | [desktop skills-manager](https://github.com/xingkongliang/skills-manager) |
|---|---|---|---|---|
| Primary UI | **Agent conversation** (manager skill) + CLI | GitHub CLI | CLI | Desktop GUI |
| Hub model | Single `~/.skills-manager` → distribute subset | Per-agent / shared `.agents/skills` | Per install | Hub + presets |
| Agents covered | **70+** (catalog snapshot) | ~48 | Depends on target | ~54 |
| Non-GitHub sources | git / URL / zip / marketplace / well-known | GitHub (+ `--from-local`) | GitHub-centric | Marketplace + git |
| Update signal | **Skill subtree tree-SHA** (no false positives) | Frontmatter tree SHA | Lockfile / metadata | App sync |
| Context cost | Built-in **resident cost ledger** | — | — | — |
| Multi-machine | Hub git sync (`sync push/pull`) | — | — | Device-code backup |
| Install | `npx skills-manager-cli` | `gh extension` | `npx skills` | Desktop download |

Pick this when you want **one library, many agents, conversation-driven ops**, and honest update/cost signals — not another one-shot installer.

## Quick Start

```sh
npx skills-manager-cli
```

![skills-manager demo](docs/assets/demo.gif)

*`--help` and the resident context-cost ledger (`cost`) in action. After bootstrap, try `cost --share` and `doctor` — both are printed as pasteable demos.*

That is the whole setup. Bootstrap creates the skill hub (`~/.skills-manager`), installs the **manager skill** into it from the bundled copy, and mounts it (symlink) into the agents it detects on your machine — you confirm the list in the one prompt it shows.

Then go back to your agent and say:

> **Take stock of my skills: what I have, which agents they are wired into, and what has updates**

**Already have skills in `~/.claude/skills` or other agent runtimes?** Don't migrate during setup — just ask your agent:

> Import my existing skills into skills-manager and tidy up their sources

Content moves into the hub, originals become symlinks (backed up first). Prefer to preview it yourself first? `skills-manager init --dry-run`.


## Coming from `npx skills` or `gh skill`?

You can keep installing with those tools. To consolidate into one hub (tree-SHA updates + the cost ledger) without re-downloading:

```sh
npx skills-manager-cli                 # bootstrap the hub + manager skill
skills-manager init --dry-run          # preview importing existing runtime skills
# or ask your agent: Import my existing skills into skills-manager
skills-manager cost --share            # privacy-safe paste card of your resident skill tax
skills-manager doctor --share          # privacy-safe hub health card (counts only)
skills-manager update --check          # freshness vs skill subtree tree-SHA (git) — no cry-wolf
skills-manager audit security --strict  # CI gate: fail only on high-severity findings
skills-manager audit overlap           # which skills compete for the same request (wrong-skill triggers)
skills-manager audit descriptions      # descriptions that will never trigger (no "use when", vague, too long)
skills-manager audit descriptions --fix # proposed rewrites as a diff; --write applies them
skills-manager sync init --remote <url> # multi-machine hub git sync (unique vs installers)
skills-manager sync status --share      # privacy-safe paste card of sync posture
```

`cost --share` prints a paste-ready card (no absolute paths). Example shape:

```text
Resident skill tax · char-approx · skills-manager
≈1.2k tokens / message · 12 skill(s) · 2 path(s)
Paths: user/claude-code+zed · project/cursor
Heaviest: big-skill ≈400 · mid ≈200 · small ≈80
Try: npx skills-manager-cli
Reproduce: skills-manager cost --share
https://github.com/shenysun/skills-manager
```

**CI?** Drop [`examples/github-actions/audit-security.yml`](examples/github-actions/audit-security.yml) into `.github/workflows/` on a hub repo (`skills/` + `registry.yaml`). It runs `audit security --strict --format github` on PR/push — fails only on high-severity findings, and annotates the PR Files tab.

Every gate exits 1 on failure and writes its verdict to stderr, so stdout (text/JSON) stays stable:

| Gate | Command | Fails when | Network |
| --- | --- | --- | --- |
| Security | `audit security --strict` | any high-severity finding | no |
| Provenance | `provenance list --fail-on-imported` | an imported skill has no usable source (can't get updates) | no |
| Resident cost | `cost --budget <tokens>` | total resident tokens exceed the budget | no |
| Freshness | `update --check --fail-on-stale` | any skill is stale, or a check fails | yes (`GH_TOKEN` helps) |
| **All of the above** | `check [--budget <tokens>] [--freshness]` | any enabled gate fails (security + provenance always; budget/freshness opt-in) — copy [`examples/github-actions/hub-check.yml`](examples/github-actions/hub-check.yml) | only with `--freshness` |

Details: [docs/CLI.md](docs/CLI.md).

Runtime copies become hub-backed; originals are backed up first.

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

## Category sets: load only what you need

Agents load skills wholesale from their runtime dir — no per-skill switch. Domain categories bring that switch to the hub: tag skills with your own vocabulary (frontend / finance / backend — free-form, no controlled list), then apply a category set so an agent's runtime dir holds **exactly** those domains.

> Tag show-me as frontend, then make claude-code load only the frontend skills

```sh
skills-manager categories set show-me frontend web   # replace the whole tag list
skills-manager categories add show-me frontend       # incremental
skills-manager categories list                       # every tag in the hub + counts
skills-manager categories apply frontend finance -a claude-code   # rewrite that runtime dir to exactly the set
skills-manager categories apply --all                # dissolve the filter, restore every managed skill
skills-manager categories status                     # per-path applied set + drift
```

Apply is an explicit, reversible snapshot: missing skills get distributed, managed skills outside the set (including untagged ones) are removed, the manager skill itself and foreign entries are never touched, and re-running the same apply changes nothing. Later tag edits never auto-push — `categories status` reports the drift and re-running `apply` converges. `distribute rollback --to user` restores the runtime content and the category-set record together. Agents sharing one physical runtime dir (an agent family) necessarily share one set. See [ADR-0015](docs/adr/0015-domain-categories-category-set-loading.md).

## Skill home layout

A skill home contains:

- `skills/`: canonical skill directories, kept flat as `skills/<skill-name>/SKILL.md`
- `collections/`: generated category symlink trees (browse-only)
- `registry.yaml`: metadata — domain categories, legacy category, tags, consumers, source (repo, subpath, ref, baseline), update policy
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
skills-manager doctor --share                     # privacy-safe hub health paste card
skills-manager list
skills-manager add owner/repo --all --yes
skills-manager distribute --to user --skill my-skill --agent claude-code
skills-manager update --plan
skills-manager update --check                     # tree-SHA freshness (git/marketplace)
skills-manager update --skill my-skill
skills-manager init --dry-run                    # preview runtime-skill import
skills-manager init --prefer claude-code hub     # this-run conflict priority
skills-manager init --resolve my-skill=cursor    # import with a conflict decision
skills-manager backup list                       # inspect init backups
skills-manager backup restore my-skill           # roll one import back
skills-manager edit my-skill --source-git owner/repo --subpath skills/my-skill
skills-manager provenance list                   # skills still missing a source
skills-manager provenance list --fail-on-imported # fail (exit 1) when any imported skill still lacks a source
skills-manager provenance adopt                  # backfill lockfile evidence
skills-manager categories set my-skill frontend     # tag with a domain category
skills-manager categories apply frontend -a claude-code  # load only that domain
skills-manager categories status                  # applied sets + drift
skills-manager cost                              # resident context-cost ledger (report-only recall suggestions)
skills-manager cost --budget 2000                # fail (exit 1) when resident context tax exceeds a token budget
skills-manager sync init --remote <url>          # multi-machine hub git sync
skills-manager sync status --share               # privacy-safe paste card of sync posture
skills-manager update --check --fail-on-stale    # fail (exit 1) when any hub skill is stale vs upstream tree-SHA
skills-manager archive old-skill
```

Sources: GitHub shorthand (`owner/repo`), Git URLs, GitHub tree URLs, local paths, direct download URLs (single `SKILL.md` / zip / tar), local zip archives, plugin marketplaces (`.claude-plugin/marketplace.json`), and well-known discovery indexes — see the [CLI reference](docs/CLI.md).

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
