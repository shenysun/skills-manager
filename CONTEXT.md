# Context

This repo is the canonical local source of truth for agent/Claude/Codex skills and the `skills` CLI/admin tool used to manage them.

## Glossary

- **Skill**: A directory containing a `SKILL.md` file and optional supporting files.
- **Canonical skill**: The maintained copy under `skills/<skill-name>/`.
- **View**: A generated symlink tree under `views/<consumer>/` that exposes canonical skills to a specific runtime such as `agents` or `claude`.
- **Consumer**: A runtime that can load skills. Current consumers are `agents` and `claude`.
- **Registry**: `registry.yaml`, the metadata source for skill paths, categories, consumers, source repositories, refs, and upstream commits.
- **Source**: A local path, Git URL, GitHub repository, or GitHub tree URL from which skills can be discovered and installed.
- **Source-first install**: The preferred install flow: provide a source first, discover available `SKILL.md` files, then choose skills to install or update.
- **Dashboard UI**: The local Vue/Fastify dashboard launched with `skills-manager dashboard` for browsing, installing, updating, and exposing skills.

## Current product direction

The project is evolving from a local skill repository into a publishable npm package that provides:

- a `skills-manager` CLI,
- a local web dashboard UI,
- source-first discovery and install/update flows,
- registry-driven update flows by skill, batch selection, or source repository,
- multi-language UI support.

## Constraints

- Keep the canonical `skills/` tree flat: `skills/<skill-name>/SKILL.md`.
- Keep generated exposure separate in `views/agents` and `views/claude`.
- Prefer registry-driven operations over ad-hoc filesystem edits.
- Treat remote `SKILL.md` metadata as untrusted; validate skill names and path containment before copying.
- Do not expose live `~/.agents/skills` / `~/.claude/skills` switch or rollback operations until explicitly planned and specified.

## Product decisions

### Package identity

The npm package name is **`@shenysun/skills-manager`**. The executable command is **`skills-manager`**.

### Architecture posture

Treat the publishable package as a **new product**, not an incremental pile-on to the current prototype. The next implementation should be a clean, maintainable redesign using mainstream architecture:

- separate core domain/application services from CLI, HTTP API, and Vue UI adapters,
- keep the web admin as a real Vue application, not inline HTML,
- keep i18n as a first-class concern,
- make `--home` / `SKILL_HOME` explicit so the npm package can manage arbitrary skill homes,
- keep local-first behavior and avoid cloud/login concerns unless specified later.

### Dashboard naming

Use **dashboard** consistently for the local web UI. Code and package paths should use `dashboard` / `dashboard-web`, not `admin` / `admin-web`. The command to launch it is `skills-manager dashboard`.

### Default skill home

When no `--home` and no `SKILL_HOME` are provided, and the current directory is not a skill home, the package should create/use the default skill home at `~/.skills-manager`.
