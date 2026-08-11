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
- **Dashboard primary navigation**: The five first-class surfaces of the Dashboard UI, organized by domain object rather than by verb: **Overview**, **Installed**, **Sources**, **Registry**, **Activity**.
  _Avoid_: Discover, Updates, and Settings as top-level nav labels; those are capabilities hosted inside the five surfaces, not separate destinations.

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

### Dashboard information architecture

Primary navigation is **five surfaces** (object-centric), not eight verb pages. Placement is **as implemented in the current dashboard WIP** (ratified in grill):

| Surface | Domain object / purpose | Hosted capabilities |
|---------|-------------------------|---------------------|
| Overview | Health and status at a glance | Counts (skills/sources/agents/claude), doctor warnings & broken links, Run Doctor, recent activity preview (link to Activity). **No** dedicated git-status card. |
| Installed | Canonical skills already in the skill home | Search/filter, category workbench, multi-select, **by-skill update** (selected / all candidates / per drawer), expose/hide consumers, archive, skill detail drawer. |
| Sources | Provenance groups and source-first install | **Library** tab: group by source, search, per-source select, **by-source update** (all/selected), discover-more-from-source. **Discover** tab: compact embedded source-first install wizard (not a standalone multi-step page; safety checks required, step chrome optional). |
| Registry | Structured registry metadata | Structured edit of safe fields only (unchanged intent). |
| Activity | Operation history + workspace snapshot | Operations timeline, git history list, skill home path, package name, npm pack dry-run. |

**Not first-class nav** (capabilities relocated):

- **Discover** → Sources · Discover tab; Topbar **Install Skill** uses the Discover deep-link (`#/sources?tab=discover` or equivalent).
- **Updates** → split: by-skill on Installed; by-source on Sources · Library. No standalone Updates surface.
- **Settings** → split: language & theme on Topbar; home / package / pack dry-run on Activity. No Settings item in primary nav.

**Global chrome (Topbar):** skill home path, Install Skill, operation log drawer, language, theme, refresh.

**Known implementation defects to fix (ratified in grill — not product intent):**

- `#/updates` must not land on Sources; either map to Installed (by-skill update surface) or drop the hash entirely after migration.
- `#/settings` and a standalone Settings page must not remain as a parallel settings surface; keep Topbar (language/theme) + Activity (home/package/pack) only.
- Dead Discover / Updates pages and unused update-center components must be removed so each capability has one home.
- Do not use `localStorage` to pass Sources tab selection across navigations; express Discover deep-link in the hash itself.

**Dashboard hash contract (ratified):**

- First-class hashes (only): `#/overview`, `#/installed`, `#/sources`, `#/registry`, `#/activity`.
- Discover deep-link (not primary nav): `#/sources?tab=discover` or equivalent `#/sources/discover` — opens Sources on the Discover tab. Topbar Install Skill uses this.
- Legacy hashes are not product surfaces; one-time redirects for bookmarks:
  - `#/discover` → Discover deep-link on Sources
  - `#/updates` → `#/installed` (by-skill update surface)
  - `#/settings` → `#/activity` (workspace prefs + history)
  After redirect, the legacy form is not a first-class destination.

### Default skill home

When no `--home` and no `SKILL_HOME` are provided, and the current directory is not a skill home, the package should create/use the default skill home at `~/.skills-manager`.
