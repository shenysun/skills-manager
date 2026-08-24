# Context

This repo is the canonical local source of truth for agent/Claude/Codex skills and the `skills` CLI/admin tool used to manage them.

## Glossary

- **Skill**: A directory containing a `SKILL.md` file and optional supporting files.
- **Canonical skill**: The maintained copy under hub `skills/<skill-name>/` — the only content tree for that skill identity.
- **Agent**: An id from the **vercel-labs/skills agent table** (the only catalog): e.g. `claude-code`, `cursor`, `codex`. Each row has a project path and a global path. Skills-manager does not invent a parallel list of consumers.
  _Avoid_: A closed set of two consumers named `agents` and `claude`; calling the shared `.agents/skills/` bucket “the Agents product”.
- **Detected agent**: An agent the **`npx skills` CLI would target with no `-a`** on this machine. Skills-manager uses that same determination; it does not invent a second heuristic.
  _Avoid_: A private PATH/folder scan that disagrees with `npx skills`; writing into every catalog home.
- **Runtime skill directory**: The folder an agent actually loads (`~/.claude/skills`, `~/.cursor/skills`, project `.agents/skills`, …). Several agents can share one directory. A distribute apply writes each distinct path **once**.
- **Consumer** (legacy word): Prefer **Agent**. Old registry tags `agents`/`claude` are not the catalog.
- **Registry**: `registry.yaml`, the metadata source for skill paths, categories, consumers (desired/default consumer tags), source repositories, refs, and upstream commits.
- **Source**: A local path, Git URL, GitHub repository, or GitHub tree URL from which skills can be discovered and installed.
- **Source-first install**: The preferred install flow: provide a source first, discover available `SKILL.md` files, then choose skills to install or update.
- **Dashboard UI**: The local Vue/Fastify dashboard launched with `skills-manager dashboard` for browsing, installing, updating, and distributing skills.
- **Dashboard primary navigation**: The five first-class surfaces of the Dashboard UI, organized by domain object rather than by verb: **Overview**, **Installed**, **Sources**, **Registry**, **Activity**.
  _Avoid_: Discover, Updates, and Settings as top-level nav labels; those are capabilities hosted inside the five surfaces, not separate destinations.
- **Skill home / hub**: The **canonical** managed root where skill *content* lives: `skills/`, `collections/` (optional), `registry.yaml`, and distribution index under `.skills/`. Default hub: **`~/.skills-manager`**. Install/update/archive happen only here (unless operator explicitly points `--home` at another hub).
  _Avoid_: A hub-local `views/` tree as an expose layer — **removed from the product model**.
- **Distribution target**: A user- or project-side place that **receives a selected subset** of hub skills for *use*, not a second independent source of truth for the same skill identity.
- **User distribution**: Publishing hub skills into the operator’s user-level **runtime skill directories**.
- **Project distribution**: Publishing a subset of hub skills into a given project’s **runtime skill directories**; one hub skill can be distributed to many projects.
- **Distribution receipt**: Manifest/state recording what was distributed where (mode, consumers, hub fingerprint) — project-side and/or hub-side index; **not** a second canonical skill library.
  _Avoid_: Managing the same logical skill as separate full trees in every project home as the primary model.
- **View (removed)**: Formerly a generated symlink tree under `views/<consumer>/`. **Superseded by distribute-to-runtime.** Do not reintroduce hub `views/` as a required layout.

## Product decisions (in progress — hub + distribute)

### Ratified direction (latest)

**Unified storage; skills-manager distributes to users and projects.**

```text
  ~/.skills-manager   ← only place skill content is managed (hub)
           │
           │ distribute(subset) → user targets
           │ distribute(subset) → project A, project B, …
```

- Cross-project reuse: same skill stays **one** object in the hub; distribute (or re-distribute) to each project that needs it.
- Dual full homes as *two sources of truth* is **rejected** for the same skill identity (forked updates, multi-copy disk, no single update).
- Absolute project → hub symlinks alone are **insufficient** for teammates without that hub; distribution mechanism must still address portability (open).

### Distribution modes (ratified)

**Hub stores once; distribute/reference supports two modes:**

| Mode | Behaviour | Typical use |
|------|-----------|-------------|
| **symlink** | Target entries are soft links **directly** into hub `skills/<name>/`. | Local machine, low disk, instant hub updates via link |
| **copy** | Target entries are real file trees copied from hub `skills/<name>/`. | Portable project trees, teammates without the same hub path, git-friendly materialization |

- Both modes are first-class; the operator may override per operation.
- Neither mode creates a second *management* library: install/update still happen only on the hub; copy targets are refreshed by re-distribute from hub.
- Symlink mode does not satisfy “unknown hub path / no manager” portability by itself; copy (or re-copy) does.

### Default distribute modes (ratified — design pass)

| Target kind | Default mode | Rationale |
|-------------|--------------|-----------|
| **User** | **symlink** | Personal machine; low disk; hub edits visible immediately via links |
| **Project** | **copy** | Portable for git/teammates; does not assume shared hub path |

Override: every distribute accepts explicit `mode: symlink | copy`.

### Design quality bar (hub + distribute)

Aim for:

1. **Single writer for content** — only hub mutates canonical skill trees.
2. **Explicit live wiring** — distribute is the only supported way to write user/project runtime skill dirs (no silent global hijack).
3. **Mode honesty** — UI/CLI labels symlink as local-only; copy as portable.
4. **Refreshability** — copy targets track hub identity (name + content fingerprint/commit) and can re-distribute.
5. **Safe apply** — path containment, no clobber of non-managed files without confirm; rollback of last distribute snapshot where feasible.
6. **Doctor visibility** — broken symlinks, outdated copies, unmanaged files in target dirs.
7. **Subset distribute** — never require shipping the entire hub to a project.

### Catalog and writer (ratified)

- **Catalog + detection:** vercel-labs/skills agent table and the same “detected” set as `npx skills` with no `-a`.
- **Writer:** skills-manager **distribute** still writes runtime directories (hub remains the only content library). Do **not** shell out to `npx skills` as the apply implementation.
- Shared runtime paths are written **once** per apply even when several selected agents map to the same folder.
- **Default apply UI:** The primary action is **接入**, which opens a picker of the **full catalog**. The remembered selection is **exactly the last confirmed apply**. Cancel does not update memory. First open (no confirm yet): detected agents are checked.
  _Avoid_: Two fixed buttons (Claude / Agents); one-click wire-all; persisting ticks from a cancelled sheet.

### Runtime destination paths (ratified — R1, superseded in part)

Paths come from the **vercel-labs/skills agent table** (global vs project column per agent id), not a two-column agents/claude matrix. The old R1 table (`~/.agents` + `~/.claude` only) is a special case of that catalog, not the product limit.

- Only **selected or detected** agents receive entries.
- **Live load paths are only those runtime directories** — there is no intermediate hub `views/` layer.
- Project portable delivery (default **copy**) materializes into each selected agent’s **project** path from the catalog.

### Symlink target and removal of views (ratified)

- **`mode=symlink`:** runtime `…/skills/<name>` → hub **`skills/<name>/`** (direct; one hop).
- **`mode=copy`:** materialize from hub **`skills/<name>/`**.
- **Delete / do not require `views/`:** hub layout no longer includes `views/agents` or `views/claude` as product surface. Legacy `expose`/`hide`/`rebuild-views` become **distribute / undistribute** (or aliases) against R1 runtime paths.
- Registry may still store agent *tags* as metadata defaults; they must be catalog ids (or migrate from legacy `agents`/`claude`), and they do not imply a views tree.
- **Collections** (category symlink trees under hub `collections/`) **remain** for organization/browsing only — not a consumer load path. Distinct from removed `views/`.

### Distribution receipts (ratified — L1)

- **Project receipt:** `<project-root>/.skills-manager/distribute.yaml`  
  Records which hub skills are distributed to this project, per-consumer, mode (`symlink`|`copy`), and hub content fingerprint / ref for outdated checks. Safe to commit for team visibility of “what this repo uses.”
- **Hub distribution index:** under the hub (e.g. `.skills/distributions.jsonl` or equivalent)  
  Records targets (user or project paths) and skill sets so the hub can list subscribers and drive `redistribute --outdated` without scanning the whole disk.
- Runtime dirs (`.agents/skills`, `.claude/skills`) stay skill entries only — no manifest clutter inside them.

### Conflict policy (ratified — C1)

When a runtime path `…/skills/<name>` already exists:

- **Managed** (created/recorded by skills-manager via receipt/index/marker): may be updated in place by re-distribute (respecting mode).
- **Foreign** (not managed): **refuse by default**; overwrite only with explicit `--force` / UI confirm.
- Never silently destroy unmanaged skill trees.

### Outdated, re-distribute, rollback (ratified — U1)

- **Fingerprint:** each distribution receipt stores a hub skill fingerprint (content hash and/or hub/upstream commit identity).
- **Outdated:** fingerprint mismatch between receipt and current hub skill ⇒ target is outdated (applies to **copy**; symlink still records fingerprint for audit, but content is live via link).
- **Re-distribute:** idempotent apply for **managed** targets; hub index enables `redistribute --outdated` across known targets.
- **Rollback:** each successful apply keeps a restore point (implementation may use `.skills-manager/backups/` on project targets and a hub-side stash for user targets) so `distribute rollback` can restore the previous managed state.

### Collections (ratified — K1)

Hub **`collections/`** stays as a generated category organization tree. It is not used for agents/claude loading. Consumer loading is only via **distribute** to R1 runtime paths.

### Design status

**Shared understanding confirmed** (grill). Recorded in [ADR-0003](docs/adr/0003-hub-distribute-no-views.md).

Remaining for `/to-spec` (not open product forks): exact receipt/index schema fields; migration steps for legacy hub `views/` on disk; CLI/Dashboard command shapes.

## Current product direction

The project is evolving from a local skill repository into a publishable npm package that provides:

- a `skills-manager` CLI,
- a local web dashboard UI,
- source-first discovery and install/update flows,
- registry-driven update flows by skill, batch selection, or source repository,
- multi-language UI support.

## Constraints

- Keep the canonical `skills/` tree flat: `skills/<skill-name>/SKILL.md`.
- Do **not** reintroduce hub `views/<consumer>/` as the expose mechanism; consumer wiring is **distribute** to runtime paths only.
- Prefer registry-driven operations and distribution receipts over ad-hoc filesystem edits.
- Treat remote `SKILL.md` metadata as untrusted; validate skill names and path containment before copying.
- Live writes under user/project agent runtime skill directories are allowed **only** via the planned **distribute** feature (symlink|copy), with doctor/rollback semantics; ad-hoc undocumented mutation of those paths remains out of scope until distribute ships.

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

### Default skill home (hub)

When no `--home` and no `SKILL_HOME` are provided, and cwd is not already a full skill-home layout, use the **hub** at `~/.skills-manager` (create if missing). Project paths are **distribution targets**, not the default management home. (Auto-detecting “open dashboard against project receipt while editing that repo” remains open.)
