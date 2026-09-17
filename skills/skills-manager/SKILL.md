---
name: skills-manager
description: Operate the skills-manager CLI — manage a local skill hub (install, import, distribute to agents/projects, update) and backfill provenance for source-less skills (adopt lockfile evidence, search the ecosystem for candidates, verify, get the user's approval, write sources). Use this skill whenever the user mentions skills-manager, the skill home / hub (~/.skills-manager), importing skills from agent runtime directories, distributing or undistributing skills, updating skills from their sources, tagging skills with domain categories (类别 / 分类 / categories), applying / inspecting a category set (类别集), or saving / switching a named preset (预设 / 档位) so an agent loads only the selected domains, wants to fix / backfill / find where a skill came from (its source, provenance, origin, upstream repo), asks to find / discover a new skill in the ecosystem (帮我找个 skill / find a skill for X), or wants to sync the skill hub across machines (多机同步 / sync push / sync pull / 我想在另一台机器上用这些 skills).
---

# Skills Manager

The user's skills live in a single **hub** (`~/.skills-manager` by default; override with `--home <path>` or `SKILL_HOME`). The hub is the only content authority: `skills/<name>/` directories plus a `registry.yaml` of metadata. Skills flow in two directions — **install/import** into the hub, **distribute** out to agent runtime directories (`~/.claude/skills`, `~/.cursor/skills`, …) as symlinks (user scope) or copies (project scope).

Key vocabulary you will need when reading output:

- **Source**: where a skill came from — `{type: git|local, url, subpath, ref, …}` on the registry entry. A skill with a `url` (+ `subpath`) is **updatable`; without one it is a *snapshot*.
- **Update detection**: the freshness engine behind `update --check` and the dashboard's 可更新 check. GitHub sources compare the skill sub-directory's tree SHA (`source.upstream_tree`) against the GitHub Trees API — one call per repo (shared by all its skills), TTL-cached, through the logged-in `gh` CLI when present (5000 req/h) or anonymous HTTPS otherwise (60 req/h). A row reading **检测失败 / detection failed** means the check did not complete — that is *not* "no update"; every failure appends a JSON line to `<home>/.skills/dashboard.log`.
- **`imported: true`**: how the skill *entered* the hub (via `init`), orthogonal to whether it has a source.
- **Detected agents**: the agent set `npx skills` would target on this machine, resolved locally from the bundled catalog snapshot.
- **Domain category / category set**: a skill's free-form `categories: []` (前端 / 金融 / backend — the user's own vocabulary, orthogonal to the frozen legacy `category`); a **category set** is the per-runtime-path applied filter state that `categories status` reports.
- **Resident cost / Cost ledger**: the per-message token cost of a distributed skill's frontmatter `name + description` (an undistributed skill costs nothing). `cost` accounts it per physical runtime path — approximately, always shown `≈` (`method: "char-approx"`).

The CLI is non-interactive (bootstrap's agent picker is the one exception); every choice is a flag. Commands print JSON — except `status` (a human-readable summary), `get` (the skill file itself), `cost` (a human ledger view; `--json` prints the machine form), and `--help`. Parse stdout; don't guess the shape.

## First run / empty hub

When the user's first message is a broad ask (“帮我看看我的 skills” / "what skills do I have"), or the hub turns out to be empty, do not assume any setup exists — orient first, then propose exactly one action:

1. `skills-manager list` — see what the hub holds. Empty output means a fresh bootstrap; say so plainly.
2. Based on what exists, offer **one** next step and wait:
   - Skills already live in runtime dirs (`~/.claude/skills`, …) → `skills-manager init --dry-run`, report the plan, import on the user's confirmation.
   - Nothing anywhere → offer to install from a source the user names (`skills-manager add owner/repo --list` first).
3. This skill itself should be mounted wherever the user works: if `skills-manager doctor` shows it missing for an agent they use, offer `skills-manager distribute --to user --skill skills-manager --agent <id>`.

Keep the first turn short: report state, propose one action, wait. Deeper workflows (like provenance backfill below) come when the user asks for them.

## Commands by task

### Inspect the library

```bash
skills-manager list [--category <c>] [--include-archived]
skills-manager list --brief           # compact rows — use this in conversation first; full rows are tens of KB
skills-manager get <name>             # zero-retention read: full SKILL.md (frontmatter + body) on stdout
skills-manager get <name> --path      # absolute hub dir, for read-only borrowing of sibling files
skills-manager status                 # distribution health: managed/outdated/foreign
skills-manager doctor                 # warnings incl. imported-without-source queue
skills-manager cost [--top <n>] [--json]  # resident-cost ledger: per-path cost + report-only recall suggestions
skills-manager catalog info           # snapshot stamp + detected agents (each with its runtime dir)
skills-manager catalog refresh        # re-pull the upstream agent table
skills-manager backup list
```

**`get` is the reference layer** — the zero-cost alternative to distributing. When you need a skill once (this conversation only), `get <name>` prints its complete SKILL.md to stdout — raw text, not JSON — and the frontmatter carries the provenance mirror (where the skill came from), so the read doubles as a trust check. Use it, then move on: nothing stays loaded. `--path` prints the hub directory instead — first stdout line, followed by a read-only notice (an archived skill resolves to its `.skills/archive/…` directory) — for reading sibling files (scripts/, references). **Read-only**: the hub is canonical, changes go through skills-manager commands. No distribution state is required; archived skills stay readable (in body mode an archived notice rides stderr, stdout stays the file body), and a miss suggests near names.

### Install from a source (source-first)

```bash
skills-manager add <owner/repo> --list            # discover first, install nothing
skills-manager add <owner/repo> --skill <name>    # install by discovered name or subpath
skills-manager add /local/path --all -y           # local sources work too; -y overwrites
```

`<source>` accepts GitHub `owner/repo`, a Git URL, a GitHub tree URL, or a local path. Always `--list` first when unsure what a source contains.

### Import skills already living in runtime dirs

```bash
skills-manager init --dry-run                     # plan only — start here
skills-manager init                               # import + replace origins with symlinks
skills-manager init --prefer claude-code ~/.agents/skills hub   # conflict priority this run
skills-manager init --resolve my-skill=hub        # per-skill override
skills-manager backup restore <skill>             # undo one import
```

Import never guesses provenance, but it *adopts evidence*: entries in the `npx skills` lockfile (`~/.agents/.skill-lock.json`) with matching names become real sources automatically (ADR-0011).

When the dry-run reports conflicts (`kind: "multi-runtime"`), walk the user through the decision rather than quoting flag docs: each location already carries its agent ids, runtime dir, and its own description — present the sides, ask which one to trust, then map the answer to `--prefer <runtime-dir>` (priority for the whole run) or `--resolve <skill>=<choice>` (one skill). A dry-run's `plannedImports` names what *would* import.

### Distribute / undistribute

```bash
skills-manager distribute --to user --skill <name> --agent claude-code --agent zed
skills-manager distribute --to project --project ./repo --skill <name> --mode copy
skills-manager undistribute --to user --skill <name> --agent claude-code
skills-manager redistribute --refresh             # re-sync stale copy targets
skills-manager distribute rollback --to user
```

Omitting `--agent` targets the **detected set** — which can be dozens of agents on a busy machine. Check `catalog info` first and name agents explicitly unless the user truly means "everywhere". User scope defaults to symlink, project scope to copy.

### Domain categories: tag skills, apply a category set

Every skill can carry free-form **domain categories** (前端 / 金融 / backend — no controlled vocabulary; `categories list` keeps the wording consistent). Tagging only writes the registry — what loads changes **only** on an explicit apply.

```bash
skills-manager categories set <skill> 前端 后端     # replace the whole list (no values = clear)
skills-manager categories add <skill> 金融          # incremental, no full restatement
skills-manager categories remove <skill> 金融
skills-manager categories list                     # every tag in the hub + per-tag skill count
skills-manager edit <skill> --categories 前端 后端  # same replace semantics inside edit
```

Map conversational tagging asks ("给 X 归到前端类" / "tag this as frontend") straight onto these commands — there are no flags for the user to remember.

`categories apply` rewrites the selected agents' runtime dirs to **exactly** the skills in the given categories: distributes what's missing, removes managed skills outside the set.

```bash
skills-manager categories apply 前端 金融 -a claude-code
skills-manager categories apply --all              # dissolve the filter, restore every managed skill
skills-manager categories status                   # per-path applied set + drift; never writes
```

Agent selection reuses distribute's mental model, not a new one: `-a` repeatable, default = detected set. The CLI itself never prompts — when the user doesn't name agents, *you* pick in conversation, the way distribute's dashboard picker behaves: detected agents prechecked when no apply has been confirmed yet, and the last confirmed apply selection — remembered per scope, within this conversation — offered as the default next time. Agents sharing one physical runtime dir (an agent family) necessarily share one category set; selection is always by agent id.

State the strict semantics plainly whenever proposing an apply:

- **Only the selected set** — managed skills outside the categories, *including uncategorized ones*, are removed from the runtime dir. It is reversible: `apply --all` restores everything, and `distribute rollback --to user` restores the runtime content and the category-set record together.
- **Exemptions** — this manager skill is always exempt (switching categories never cuts off this conversation); foreign (unmanaged) entries are never touched.
- **Idempotent** — re-running the same apply changes nothing; recovering from an interruption is just "run it again".
- **No auto-push** — apply is an explicit snapshot; later tag edits or updates never mutate the runtime. `categories status` reports the drift ("N skills now match the set but are undistributed") and names the re-run command that converges.

**Presets (预设 / 档位)** give a category list a name, so switching is one command instead of restating categories (ADR-0019):

```bash
skills-manager preset set frontend 前端 ui     # save / replace a named preset (categories may not exist yet — build first, tag later)
skills-manager preset list                     # members + mount footprint (paths carrying it; drift reported, never implied healthy)
skills-manager preset remove frontend          # delete + cascade-clear the name off every mounted path (runtime untouched)
skills-manager preset apply frontend -a claude-code
```

Map 档位-speak straight onto these — there are no flags for the user to remember: "换个档位" / "只留前端技能" / "切到 X 组合" → `preset apply`; "记住这个组合" → `preset set`. When a name already holds the list, apply the name — never restate the categories.

`preset apply` carries **exactly the strict semantics above** (uncategorized removed, manager skill exempt, foreign untouched, reversible via `distribute rollback --to user`) plus two hard errors that protect the saved object: a preset resolving to zero managed skills, or one referencing a category that no longer exists, both refuse at apply time naming the preset and its categories — relay the error verbatim; it points at the fix (tag skills into the categories, or re-`set` the preset's list). The success output ends with the preset's **resident-cost line** (`≈` tokens, char-approx): state the strict semantics *and* the cost line whenever proposing an apply — the same warnings `categories apply` gets, so switching 档位 never sounds cheaper or safer than it is.

### Update from sources

```bash
skills-manager update --check                     # freshness detection: stale / upToDate / failed / skipped
skills-manager update --plan                      # candidates only (url + subpath) — no freshness check
skills-manager update --skill <name>
skills-manager update --source <key>              # one repo group from the plan
```

Only skills with `source.url` **and** `source.subpath` are candidates — which is why backfill (below) always writes both.

`--check` answers "is anything actually new": it compares each candidate's anchored tree SHA against the GitHub Trees API (one call per repo, through the logged-in `gh` when present), so present its `stale` list as the real update set. `failed` rows mean the check did not complete — each row carries the log path (`<home>/.skills/dashboard.log`) with the timestamped cause; usual suspects are network flaps and, without a logged-in `gh`, the 60 req/h anonymous API limit. `--plan` lists candidates without checking — don't present a plan entry as "has an update".

Git installs and updates are shallow (`--depth 1`); a network-class clone failure (HTTP/2 stream reset and friends) is retried once over HTTP/1.1 automatically. Detection anchors on the skill sub-directory's tree SHA, so an unrelated upstream commit (a README bump) does not flag an update. When the dashboard shows 检测失败 (detection failed), read `<home>/.skills/dashboard.log` for the timestamped cause — usual suspects are network flaps and, without a logged-in `gh`, the 60 req/h anonymous API limit.

### Supply or fix one skill's source

```bash
skills-manager edit <skill> --source-git <owner/repo> --subpath <path> [--source-ref <ref>]
skills-manager edit <skill> --title "New title" --description "…" --category <c> --tags a b
```

`--source-git` normalizes `owner/repo` (or a full GitHub URL) to the canonical repo URL, so the entry lands in exactly the shape `add` writes and immediately qualifies for `update`.

### Maintenance

```bash
skills-manager provenance list [--json]           # the backfill queue (see workflow)
skills-manager provenance adopt [--dry-run] [--skill <name>]
skills-manager archive <skill>                    # keep content, hide from lists
skills-manager rebuild-collections
skills-manager migrate-consumers                  # one-shot legacy-tag migration
skills-manager migrate-views                      # leftover hub views → runtimes (legacy)
skills-manager bootstrap [--agent <id...>] [--force]  # (re)mount this skill onto agents
skills-manager web [-p 4777]                      # local dashboard
```

## Workflow: find and install a skill (查找与发现技能)

Run this when the user asks "帮我找个处理 PDF 的 skill" / "find a skill for X" — discovering a *new* skill from the ecosystem is a first-class flow, not a backfill side effect. The sequence:

1. **Distill English keywords** from the ask. The channels are English-keyword search engines: a Chinese ask becomes 2–3 English words ("处理 PDF 的" → `pdf`), never a translated sentence.
2. **Search the shared channel table** (below) — one query; the first channel that answers serves the result.
3. **Verify before presenting** — the same bar as backfill: for each top candidate, fetch the upstream `SKILL.md` and compare its `name`/`description` against what the user asked for. Discard mismatches — junk candidates cost more trust than fewer, better ones.
4. **Present with evidence**: `name`, `owner/repo`, `installs` (an adoption signal, never a quality verdict — say so when showing the number), and the skills.sh link (`https://skills.sh/<owner>/<repo>/<skillId>`). Name the channel that served the result.
5. **Install only on the user's pick**, through the unchanged source-first machinery. The API's `source` field is already `owner/repo` and `skillId` is the skill's directory inside that repo:

   ```bash
   skills-manager add <source> --list              # confirm the skill is there and its exact name/subpath
   skills-manager add <source> --skill <skillId>   # the selector matches a discovered name or subpath
   ```

   Distribution stays a separate, explicit step — offer `distribute` afterwards if the user wants the skill live for an agent.

### Search channel table (shared — ADR-0021)

Both consumers use this one table: the find workflow above and provenance backfill Step 3. Defined once here, referenced there.

| # | Channel | Command |
|---|---------|---------|
| ① | skills.sh direct API (**primary**) | `curl -s --max-time 30 "https://skills.sh/api/search?q=<kw>"` |
| ② | `npx skills find` (second — buffer against API drift) | `npx -y skills find "<kw>"` |
| ③ | GitHub code search (last resort) | `gh api -X GET search/code -f q='filename:SKILL.md "<kw>" in:file' -f per_page=10 --jq '.items[] | {repo: .repository.full_name, path: .path}'` |

Channel discipline:

- **English keywords only; one query, no retries** — no re-querying, no guessed or undocumented API parameters. The single exception is channel ③'s rate-limit handling, spelled out in its own row of discipline below.
- **Any failure = channel unavailable, degrade silently**: a timeout (cap ~30s), a non-200, JSON that fails to parse, or a missing/empty `skills` array all mean "try the next channel". The user sees one result set, not the failed attempts — but the presented result names the channel that produced it.
- Channel ① returns structured JSON — `skills: [{id, skillId, name, installs, source}]` — with `source` = `owner/repo` and `id` = `source/skillId`.
- Channel ② output lines look like `owner/repo@skillname <installs>` with a `https://skills.sh/...` link; on some npm setups `npx` chokes on this package with `Unknown command` — that is the channel being unavailable, not your query being wrong.
- Channel ③ returns noise on generic names — prefer a distinctive phrase as the quoted term. Rate limits (429/403) are common: wait ~20s, retry once (the one sanctioned retry), then switch the phrase before giving up on the channel.

## Workflow: backfill sources for the whole library

Run this when the user asks to "补齐来源 / fix sources / find out where these skills came from / make them updatable", or when `doctor` reports imported-without-source skills. The rule that governs everything: **evidence is adopted automatically; guesses are never written without the user picking them, one skill at a time** (ADR-0012).

### Step 1 — Adopt deterministic evidence (no questions asked)

```bash
skills-manager provenance adopt --dry-run   # preview, then:
skills-manager provenance adopt
```

This re-runs the lockfile-evidence adoption over legacy imports. Report how many were adopted and how many remain.

### Step 2 — Get the remaining queue

```bash
skills-manager provenance list --json
```

Two buckets: `importedWithoutSource` (came from runtime dirs, evidence missing) and `locallyAuthored` (the user wrote them). Work through **both** — locally-authored skills usually just need a "confirm" (Step 4), not a source.

### Step 3 — Search and verify, one skill at a time

When the queue is more than a handful (5+), fan the search out to parallel subagents — each takes a slice of skills through the steps below and returns structured candidates — then come back and run Step 4 yourself. Searching parallelizes; approving does not.

For each pending skill:

1. Read its `SKILL.md` frontmatter (`name`, `description`) from the hub — that's the query material. Distill it to English keywords per the channel table's discipline.
2. **Search the shared channel table** — the ordered three channels and their discipline live in one place: the *"Search channel table"* section under **Workflow: find and install a skill** (above). This step is the table's other consumer; it never redefines it.
3. **Verify before presenting.** For each top candidate, fetch the upstream `SKILL.md` and compare its `name`/`description` with the local copy:

   ```bash
   curl -sL https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<path-without-SKILL.md>/SKILL.md
   ```

   A matching name plus a matching (or clearly evolved) description is a verified candidate. Discard mismatches — showing the user junk candidates costs more trust than showing fewer, better ones.

### Step 4 — The user decides, one skill at a time

Present exactly one question per skill (AskUserQuestion or equivalent single choice), batched at the platform's per-prompt cap — 4 questions per round on Claude Code, so a 17-skill queue is ~5 rounds, not 17 interruptions. Each question shows the verified candidates (labelled with `owner/repo`, install count, and how well it matched), plus:

- **"Locally authored — keep as-is"**: the user wrote it; write nothing. An honest local snapshot is the correct end state — never invent an upstream.
- **"Skip for now"**: leave it in the queue.

When the user picks a candidate, write it immediately:

```bash
skills-manager edit <skill> --source-git <owner/repo> --subpath <dir-inside-repo>
```

If the search or verification produced nothing trustworthy, say so plainly and offer only locally-authored / skip — do not pad the list with unverified guesses.

### Step 5 — Report

```bash
skills-manager doctor
```

Summarize: adopted-from-lockfile count, sources written by approval, confirmed locally-authored, skipped, and the before/after of the doctor queue.

## Workflow: audit resident context cost

Every distributed skill charges every message the tokens of its frontmatter `name + description` — its **resident cost**. That is the account `skills-manager cost` keeps: totals grouped by physical runtime path (a shared path counted once, its agent family noted), per-skill lines under each path, and report-only recall suggestions. Consult it unprompted when the user wonders what their agents pay per message (常驻成本 / context cost) — and when it shows expensive or zero-controversy distributions, propose the recall yourself instead of waiting to be asked.

```bash
skills-manager cost --json                 # the full three-layer ledger — parse this in conversation
skills-manager cost                        # human view: path groups → per-skill lines → total + unmanaged line → suggestions
skills-manager cost --top 10               # widen the expensive-descriptions list (default 5)
```

The JSON carries `paths[]` (each with `runtimeDir`, `kind`, `agents`, per-skill lines), the top-level `totalTokens` and `method`, a three-layer `suggestions` object, an `unmanaged` count for foreign entries the ledger honestly omits, and an `errors` list for unreadable entries (counted 0; entries missing a description are flagged `incomplete`).

- **Approximations, always.** `method` is `"char-approx"` (CJK characters ×1, everything else ÷4) and every displayed number is `≈`-prefixed — never relay a ledger number to the user as an exact token count.
- **Suggest recalls, never execute them.** Every suggestion carries a verbatim runnable `undistribute` command (including the required `--to`, and `--project` where the path is a project target). Acting on it is the user's decision. Only `undistribute` is ever suggested — `get` (the reference layer) and `archive` are user-side follow-ups you may narrate but not run.
- **Suggestion layers, in order**: archived-but-distributed skills (zero-controversy recalls — the impossible-to-miss head section), top-N most expensive descriptions, and scattered distributions (one skill across several paths — consolidate to one).

## Workflow: sync the hub across machines (多机同步)

Run this when the user asks "我想在另一台机器上用这些 skills" / "sync my skills" / "多台电脑怎么同步". The hub itself becomes a git repository; push/pull over the user's own remote is the whole sync mechanism (ADR-0020) — no device codes, no managed tokens, git stays the merge tool. Three moments, three commands:

**First machine — set up once:**

```bash
skills-manager sync init --remote <url>   # git init (or adopt), canonical .gitignore, baseline commit, attach origin
```

`init` **adopts** an existing `.git/` (a manually git-ified hub is a step ahead, not an error — history kept), appends only the missing canonical `.gitignore` lines, makes one baseline commit when the tree has anything to commit, and reports exactly what it did, zero omission. `.backups/` and `.skills/` (distribution index, rollback snapshots, activity log) are machine-local and never sync — distribution is per machine, on purpose. A local bare repo works as the remote too. The output ends with a reminder to confirm the hub holds no secrets before it is pushed — relay it, don't bury it.

**After changes — the routine, on every machine:**

```bash
skills-manager sync push     # add -A + one skill-level summary commit + push
skills-manager sync status   # read-only probe: git-ified?, remote, dirty count, ahead/behind, last sync commit
```

`push` is snapshot-at-push-time — no write point ever auto-commits. With a clean tree and an up-to-date remote it reports "already in sync" and exits 0, never an empty commit. `status` is zero-network: ahead/behind reads the remote-tracking ref as of the last fetch and says so. `sync status --json` is the machine-readable form when you need to report sync posture in conversation.

**New machine — get the content, then distribute yourself:**

```bash
skills-manager sync pull     # fetch + merge; ends with skill-level stats and a distribute reminder
```

`pull` ends with what the merge brought in (added / updated / removed skills, registry flag); the **not yet distributed** reminder prints only when skills actually arrived — the follow-up is the user's call. Offer `distribute` as the explicit next step when they want pulled skills live for an agent; never run it unprompted after a pull.

Discipline — matching the CLI's hard gates. When the user hits one, the nonzero exit already carries this guidance; relay it, don't soften it:

- **pull never auto-distributes**, and never runs over a dirty tree — it refuses and points at `sync push` or manual handling. It never stashes.
- **Conflicts are the user's**: pull exits nonzero and points at `git -C <hub> status` — skills-manager never makes merge decisions. Merge commits are allowed; there is no rebase and no ff-only.
- **A missing git identity, no remote, or an un-gitified hub are hard errors** on push/pull (with guidance) — the tool never configures git or picks a remote on the user's behalf. `sync status` on an un-gitified hub is the exception: a friendly hint plus exit 0.
- Bootstrap never git-initializes the hub — sync is the user's explicit opt-in.

## Autonomy rules

- Act on your own: previews, evidence adoption, listing, searching, verifying candidates.
- Ask the user: every guessed-source write, one skill per question. Batch the *questions*, never the *writes*.
- Never: write a source the user didn't pick, fabricate an upstream for a locally-authored skill, or touch the `npx skills` lockfile (read-only evidence).

## Notes

- Command surface changes faster than this file: when a command errors as unknown, `skills-manager --help` and `docs/CLI.md` in the skills-manager repo are the authority.
- `npx skills` interoperability after import is not promised; advise the user to manage skills through skills-manager once imported.
