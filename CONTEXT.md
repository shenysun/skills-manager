# Context

This repo is the canonical local source of truth for agent/Claude/Codex skills and the `skills` CLI/admin tool used to manage them.

## Glossary

- **Skill**: A directory containing a `SKILL.md` file and optional supporting files.
- **Canonical skill**: The maintained copy under hub `skills/<skill-name>/` — the only content tree for that skill identity.
- **Agent**: An id from the **vercel-labs/skills agent table** (the only catalog): e.g. `claude-code`, `cursor`, `codex`. Each row has a project path and a global path. Skills-manager does not invent a parallel list of consumers.
  _Avoid_: A closed set of two consumers named `agents` and `claude`; calling the shared `.agents/skills/` bucket “the Agents product”.
- **Detected agent**: An agent the **`npx skills` CLI would target with no `-a`** on this machine. Skills-manager uses that same determination; it does not invent a second heuristic. The determination runs **locally against the catalog snapshot** — same rule, same data, refreshed together.
  _Avoid_: A private PATH/folder scan that disagrees with `npx skills`; writing into every catalog home.
- **Agent catalog snapshot**: The vercel-labs/skills agent table bundled as a versioned data file inside the package (agent id, global path, project path, detection rule; stamped with upstream commit + date). The single source for agent enumeration, destination paths, and detection; updated only by explicit `catalog refresh`.
  _Avoid_: Runtime fetching of the table; hard-coding agent lists or detection rules in code.
- **Agent family**: The set of catalog agents sharing one physical runtime directory (e.g. the ~30 agents on `~/.agents/skills`). Selection is always by agent id; a family is never a selection unit — it exists only as picker select-all convenience and badge grouping.
- **Runtime skill directory**: The folder an agent actually loads (`~/.claude/skills`, `~/.cursor/skills`, project `.agents/skills`, …). Several agents can share one directory. A distribute apply writes each distinct path **once**.
- **Consumer** (legacy word): Prefer **Agent**. Old registry tags `agents`/`claude` are not the catalog.
- **Registry**: `registry.yaml`, the metadata source for skill paths, categories, consumers (desired/default consumer tags), source repositories, refs, and upstream commits.
- **Source**: A local path, Git URL, GitHub repository, or GitHub tree URL from which skills can be discovered and installed.
- **Source-first install**: The preferred install flow: provide a source first, discover available `SKILL.md` files, then choose skills to install or update.
- **Dashboard UI**: The local Vue/Fastify dashboard launched with `skills-manager web` for browsing, installing, updating, and distributing skills.
- **Skill library (dashboard surface)**: The Dashboard UI's single page — hub skills as rows with in-place actions (接入 / 更新 / 删除). Ratified 2026-08-25 in [ADR-0005](docs/adr/0005-dashboard-single-surface-skill-library.md).
  _Avoid_: Overview / Sources / Registry / Activity as dashboard destinations; "primary navigation" as a dashboard concept (superseded five-surface IA of ADR-0002).
- **Skill preview**: The Dashboard UI's **read-only** viewer for one hub skill, opened from a skill row as a wide Sheet: file tree on the left, selected file's content on the right (`.md` rendered as HTML, source files syntax-highlighted, other files a placeholder). No mutation from the preview.
  _Avoid_: Editing from the preview; treating preview content as trusted HTML; a second detail surface outside this Sheet.
- **Skill home / hub**: The **canonical** managed root where skill *content* lives: `skills/`, `collections/` (optional), `registry.yaml`, and distribution index under `.skills/`. Default hub: **`~/.skills-manager`**. Install/update/archive happen only here (unless operator explicitly points `--home` at another hub).
  _Avoid_: A hub-local `views/` tree as an expose layer — **removed from the product model**.
- **Distribution target**: A user- or project-side place that **receives a selected subset** of hub skills for *use*, not a second independent source of truth for the same skill identity.
- **User distribution**: Publishing hub skills into the operator’s user-level **runtime skill directories**.
- **Project distribution**: Publishing a subset of hub skills into a given project’s **runtime skill directories**; one hub skill can be distributed to many projects.
- **Distribution index**: The hub-side record of what was distributed where — `.skills/distributions.jsonl`, one record per target (user or project) whose entries carry a **physical layer** (path, mode, fingerprint, managed marker) plus a **logical layer** (the catalog agent ids that motivated the write); **not** a second canonical skill library. Projects carry no distribution metadata (see [ADR-0007](docs/adr/0007-project-no-in-repo-metadata.md)).
  _Avoid_: Managing the same logical skill as separate full trees in every project home as the primary model.
- **Import (init)**: `skills-manager init` — the **reverse of distribute**: discover skills already living in detected agents' global runtime directories and fold them into the hub. Content moves into hub `skills/<name>/`; each originating runtime path becomes a symlink back to it (original moved to a Backup first). Imported entries carry `imported: true` with no source — skills-manager does not guess provenance or manage their updates. Ratified 2026-08-25 in [ADR-0006](docs/adr/0006-init-reverse-import-symlinks.md).
  _Avoid_: Copying runtime trees while leaving originals live (two canonical copies); scanning directories outside the catalog; guessing upstream repos.
- **Backup**: Hub `.backups/<skill>-<timestamp>/` — the displaced original recorded before init replaces a runtime path with a symlink. Auto-expires after 30 days; listed and restored via `backup list` / `backup restore <skill>`.
  _Avoid_: Treating backups as a second skill store; requiring manual cleanup.
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
- Absolute project → hub symlinks alone are **insufficient** for teammates without that hub; portability is answered by **copy + git** (the project collaboration model, [ADR-0007](docs/adr/0007-project-no-in-repo-metadata.md)) — no in-repo manifest required.

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
- **Delete / do not require `views/`:** hub layout no longer includes `views/agents` or `views/claude` as product surface. Legacy `expose`/`hide`/`rebuild-views` were deprecated aliases, then **deleted outright** (2026-08-24, pre-publish clean break — see any-agent distribute section).
- Registry may still store agent *tags* as metadata defaults; they must be catalog ids (or migrate from legacy `agents`/`claude`), and they do not imply a views tree.
- **Collections** (category symlink trees under hub `collections/`) **remain** for organization/browsing only — not a consumer load path. Distinct from removed `views/`.

### Distribution records (ratified — L1; in-repo receipt removed 2026-08-26, ADR-0007)

- **Hub distribution index — the only distribution record:** `.skills/distributions.jsonl` under the hub.  
  Records every target (user or project paths) and its entries (skill, runtime path, mode, fingerprint, managed marker, agents, appliedAt) so the hub can list subscribers and drive `redistribute --outdated` without scanning the whole disk.
- **No in-repo metadata:** a distributed project contains only skill entries (copy contents or symlinks) — no `.skills-manager/` directory, no receipt, no backups.
- Runtime dirs (`.agents/skills`, `.claude/skills`) stay skill entries only — no manifest clutter inside them.

### Project collaboration model (ratified 2026-08-26, ADR-0007)

- **git is the sync channel.** Project default `copy` materializes skill contents into the repo; committing them is how skills reach collaborators.
- **Distribution authority stays with the first distributor.** Teammates are pure consumers: committed contents load directly, their machines keep no record, and the C1 foreign-refusal against re-distributing the same path is protection, not a bug (takeover requires explicit `--force`).

### Conflict policy (ratified — C1)

When a runtime path `…/skills/<name>` already exists:

- **Managed** (created/recorded by skills-manager via the hub index): may be updated in place by re-distribute (respecting mode).
- **Foreign** (not managed): **refuse by default**; overwrite only with explicit `--force` / UI confirm.
- Never silently destroy unmanaged skill trees.

### Outdated, re-distribute, rollback (ratified — U1)

- **Fingerprint:** each hub-index entry stores a hub skill fingerprint (content hash and/or hub/upstream commit identity).
- **Outdated:** fingerprint mismatch between index entry and current hub skill ⇒ target is outdated (applies to **copy**; symlink still records fingerprint for audit, but content is live via link).
- **Re-distribute:** idempotent apply for **managed** targets; hub index enables `redistribute --outdated` across known targets.
- **Rollback (user targets only):** each successful user apply keeps a hub-side restore point (`.skills/distribute-backups/`) so `distribute rollback` can restore the previous managed state. Project takes no snapshots — git is its restore point; `distribute rollback` on a project target errors (`project rollback not supported`).

### Collections (ratified — K1)

Hub **`collections/`** stays as a generated category organization tree. It is not used for agents/claude loading. Consumer loading is only via **distribute** to R1 runtime paths.

### Any-agent distribute via catalog snapshot (ratified — grill 2026-08-24)

Distribute targets the **full agent catalog** (all 73 ids), not the legacy `agents`/`claude` pair. Recorded in [ADR-0004](docs/adr/0004-any-agent-distribute-catalog-snapshot.md); research notes in `.scratch/agent-catalog-distribute/research-agent-catalog.md`.

1. **Catalog data** — bundled snapshot (extracted from upstream `src/agents.ts`; MIT, attribution kept; stamped with upstream commit + date) + explicit `catalog refresh` command. No runtime fetch, no shelling out to `npx skills`.
2. **Detection** — detection rules ship **as data inside the snapshot**; the same rule runs locally against the same data. Detected is only: the CLI default target when no `--agent` is given, and first-open picker checks. Never a gate.
3. **Distribution index entries are dual-layer** — the physical entry (path, mode, fingerprint, managed marker) carries undistribute / outdated / foreign-refusal; the logical layer (agent id list) carries provenance and display. Shared-path undistribute uses **reference counting**: the physical entry is removed only when its last referencing agent is undistributed.
4. **No-baggage migration** — the loader **hard-fails** on legacy `agents`/`claude` tags with an actionable error pointing at `migrate-consumers`, which rewrites `registry.yaml` **and** the hub index in one shot (dry-run + rollback; its former project-receipt leg was removed with the receipt itself, ADR-0007). Mapping is identity-preserving: `claude` → `claude-code`; `agents` → every catalog id whose global path is `~/.agents/skills` (6 ids in the current snapshot; the project-path family on `.agents/skills` is the ~30-agent group). Zero permanent translation layer. (Supersedes an earlier in-grill lean toward permanent read-time normalization.)
5. **Scope axis** — user/project stays orthogonal to agent selection and is chosen first; the picker filters validity per scope. Project-only agents (`eve`, `promptscript`) appear **grayed with a reason** on user scope, not hidden.
6. **CLI surface** — `--agent <id...>` is the only selection flag; `--consumer`, `expose`, `hide`, `rebuild-views` are **deleted** (pre-publish break; the package has zero external users today). `--migrate-views` stays.
7. **Picker shape** — search box + two sections (已检测 / 全部目录); family **select-all** on shared paths is pure UI sugar over an agent-id selection; one mode selector per apply (defaults user→symlink, project→copy); scope toggle at sheet top; memory is **per scope** and equals exactly the last confirmed apply. Amended 2026-08-25 (distribute-picker-ux): under the search box sits a quick-action line — **全选 / 全选已检测 / 清空** — acting on the visible (search-filtered) set: invisible rows keep their ticks, invalid agents never join; family headers (and their select-all) render only for families with ≥2 members — singletons lie flat as plain rows; project scope prefills `knownProjects[0]` — from `/api/state`, a read-only derivation of hub-index `kind=project` records ordered by `updatedAt` desc — into a native `<datalist>`, and an empty project path disables apply (the catalog endpoint 400s a rootless project query instead of falling back to the server cwd).
8. **Physical-first display & doctor** — badges show one chip per physical target with agent drill-down; Overview reports managed-entry count + unique agent coverage (replacing the `agents`/`claude` count fields); doctor scans only paths known from the hub index, never the whole catalog.
9. **Dialog scroll lock** (2026-08-25, distribute-picker-ux) — the Sheet base component locks body scroll while any dialog (接入 picker, 撤除, add wizard, confirm) is open and restores it on close; a module-level open-count makes nested dialogs keep the lock until the last one closes, and `scrollbar-gutter: stable` on `html` prevents the hidden scrollbar from shifting the page sideways.

### Design status

**Hub + distribute: shipped** — ADR-0003's open items (receipt/index schema, views migration, command shapes) were implemented in the `hub-distribute-no-views` feature.

**Any-agent distribute: shared understanding confirmed** (grill 2026-08-24). Recorded in ADR-0004; ready for `/to-spec`.

**Single-surface minimal dashboard: shipped** (2026-08-25). ADR-0005 implemented as specced in `.scratch/dashboard-single-surface/spec.md`: `dashboard-web` rewritten from scratch as the single-page skill library (typographic flow), the dashboard HTTP API trimmed to the single-page contract (`GET /api/state` slimmed with per-skill `distributedAgents` from the hub index; dead endpoints deleted; `POST /api/skills/remove` added as the one-step remove), core services and CLI untouched.

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
- Prefer registry-driven operations and the hub distribution index over ad-hoc filesystem edits.
- Treat remote `SKILL.md` metadata as untrusted; validate skill names and path containment before copying. The same applies to **file content shown in the dashboard**: skill bodies come from third-party sources and must be sanitized before insertion into the DOM.
- Live writes under user/project agent runtime skill directories are allowed **only** via the planned **distribute** feature (symlink|copy), with doctor/rollback semantics; ad-hoc undocumented mutation of those paths remains out of scope until distribute ships.

## Product decisions

### Package identity

The npm package name is **`agent-skills-manager`**. The executable command is **`skills-manager`**.

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

**Single-surface skill library (ratified 2026-08-25 — supersedes the five-surface IA of ADR-0002; see [ADR-0005](docs/adr/0005-dashboard-single-surface-skill-library.md)).**

The dashboard is **one page** — the skill library — plus two entries:

- **Skill library** (the only page): every hub skill is a row with in-place actions — 接入 (opens the any-agent picker), update, remove. **Remove is one-step**: undistribute all + archive, behind a confirm that states the consequence. A standalone **撤除接入** (agent-side only, skill stays in the library) also exists in row overflow. Search/filter stay; category tooling collapses into row overflow. **Batch is one unified pattern — selection mode**: checkboxes are invisible until hover; checking the first one enters selection mode with a floating bottom bar (已选 N · 更新 / 接入 / 移除 · 取消); Esc or 取消 exits. While selection mode is active, clicking anywhere on a row toggles its checkbox (the row-name preview entry is suspended); it resumes when selection mode exits. No persistent multi-select toolbar, no per-source group selector. A top inline strip `N 个可更新 · 全部更新` appears only when updates exist and executes directly. Doctor signal (broken links, outdated copies) becomes per-row status marks.
- **Skill preview entry** (ratified 2026-08-25): clicking a skill row's **name** opens the **Skill preview** Sheet (also reachable from row overflow). Skill rows otherwise keep no whole-row click behavior.
- **+ 添加技能** (top-right): opens the source-first install wizard. The Sources surface disappears; the wizard survives.
- **日志** drawer (top-right): the operation log survives as a drawer. The Activity surface disappears.

Explicit cuts: **Overview** (per-row status marks instead), **Registry editor** (no dashboard surface; `registry.yaml` remains the metadata backbone, edited by hand or CLI), **Activity page** (log drawer only), **update center** (in-place row actions only), **Settings** (language/theme survive as small topbar toggles). No primary navigation.

Rationale: the measured daily line is distribute / remove / install / update — all one object (the skill). Three of five surfaces saw no real use.

All legacy hashes redirect to the single page.

**Implementation posture (ratified 2026-08-25):** `dashboard-web` is **rewritten from scratch** — new code and components, no migration of old component code; behaviour follows ADR-0004 (picker, index entries) and ADR-0005 (IA). The HTTP API layer is trimmed: dead dashboard endpoints deleted, single-page endpoints kept or adjusted. Core services and CLI are untouched. Vue 3 stays; i18n (zh/en) and light/dark theme remain as small topbar toggles.

**Visual baseline (ratified via prototype 2026-08-25; implemented by the 2026-08-25 rewrite):** the **typographic flow** variant won (prototype variant C; the three-variant file is preserved on the throwaway branch `prototype/single-surface-skill-library`). The question settled: what the single-page skill library looks like. Baseline traits, as implemented by the rewrite:

- Narrow single column (~720px), interface-as-document: no cards, no table lines, no sidebar, no toolbar chrome.
- Skill entry: bold name + status as plain text on the right (`7 agents` / `可更新` / `⚠ 副本过期`) — text, not chips; grey description on a second line.
- Actions fade in on row hover as text buttons (更新 · 接入 · 更多), replacing the status text while hovered.
- Header is one line: title + text links (日志, ＋添加) + underline-only search box.
- Update notice is one text line with a text button — no colored strip.

Losing variants (A compact table rows, B airy cards) were rejected for chrome/visual-block weight; the prototype file keeps all three for reference.

### Default skill home (hub)

When no `--home` and no `SKILL_HOME` are provided, and cwd is not already a full skill-home layout, use the **hub** at `~/.skills-manager` (create if missing). Project paths are **distribution targets**, not the default management home.
