---
name: skills-manager
description: Operate the skills-manager CLI — manage a local skill hub (install, import, distribute to agents/projects, update) and backfill provenance for source-less skills (adopt lockfile evidence, search the ecosystem for candidates, verify, get the user's approval, write sources). Use this skill whenever the user mentions skills-manager, the skill home / hub (~/.skills-manager), importing skills from agent runtime directories, distributing or undistributing skills, updating skills from their sources, or wants to fix / backfill / find where a skill came from (its source, provenance, origin, upstream repo).
---

# Skills Manager

The user's skills live in a single **hub** (`~/.skills-manager` by default; override with `--home <path>` or `SKILL_HOME`). The hub is the only content authority: `skills/<name>/` directories plus a `registry.yaml` of metadata. Skills flow in two directions — **install/import** into the hub, **distribute** out to agent runtime directories (`~/.claude/skills`, `~/.cursor/skills`, …) as symlinks (user scope) or copies (project scope).

Key vocabulary you will need when reading output:

- **Source**: where a skill came from — `{type: git|local, url, subpath, ref, …}` on the registry entry. A skill with a `url` (+ `subpath`) is **updatable`; without one it is a *snapshot*.
- **`imported: true`**: how the skill *entered* the hub (via `init`), orthogonal to whether it has a source.
- **Detected agents**: the agent set `npx skills` would target on this machine, resolved locally from the bundled catalog snapshot.

The CLI is non-interactive; every choice is a flag. All commands print JSON (except a few human summaries) — parse stdout.

## Commands by task

### Inspect the library

```bash
skills-manager list [--category <c>] [--include-archived]
skills-manager status                 # distribution health: managed/outdated/foreign
skills-manager doctor                 # warnings incl. imported-without-source queue
skills-manager catalog info           # catalog snapshot stamp + detected agents
skills-manager catalog refresh        # re-pull the upstream agent table
skills-manager backup list
```

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

### Distribute / undistribute

```bash
skills-manager distribute --to user --skill <name> --agent claude-code --agent zed
skills-manager distribute --to project --project ./repo --skill <name> --mode copy
skills-manager undistribute --to user --skill <name> --agent claude-code
skills-manager redistribute --refresh             # re-sync stale copy targets
skills-manager distribute rollback --to user
```

Omitting `--agent` targets the detected set. User scope defaults to symlink, project scope to copy.

### Update from sources

```bash
skills-manager update --plan                      # no args = plan (also this)
skills-manager update --skill <name>
skills-manager update --source <key>              # one repo group from the plan
```

Only skills with `source.url` **and** `source.subpath` are candidates — which is why backfill (below) always writes both.

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
skills-manager web [-p 4777]                      # local dashboard
```

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

1. Read its `SKILL.md` frontmatter (`name`, `description`) from the hub — that's the query material.
2. **Primary channel** — the skills.sh ecosystem:

   ```bash
   npx -y skills find "<name>"
   ```

   Output lines look like `owner/repo@skillname <installs>` with a `https://skills.sh/...` link. Pass a real query word — never `--help`. Treat *any* failure as "channel unavailable" and move on: empty results, a hang (cap at ~30s, don't retry), or the command itself erroring — on some npm setups `npx` chokes on this package with `Unknown command`, which has nothing to do with your query.
3. **Fallback channel** — GitHub code search (authenticated `gh` works offline of skills.sh):

   ```bash
   gh api -X GET search/code -f q='filename:SKILL.md "<name>" in:file' -f per_page=10 \
     --jq '.items[] | {repo: .repository.full_name, path: .path}'
   ```

   Generic names return noise; prefer a distinctive phrase from the description as the quoted term. Rate limits (429/403) are common — wait ~20s, retry once, then switch the phrase before giving up on the channel.
4. **Verify before presenting.** For each top candidate, fetch the upstream `SKILL.md` and compare its `name`/`description` with the local copy:

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

## Autonomy rules

- Act on your own: previews, evidence adoption, listing, searching, verifying candidates.
- Ask the user: every guessed-source write, one skill per question. Batch the *questions*, never the *writes*.
- Never: write a source the user didn't pick, fabricate an upstream for a locally-authored skill, or touch the `npx skills` lockfile (read-only evidence).

## Notes

- Command surface changes faster than this file: when a command errors as unknown, `skills-manager --help` and `docs/CLI.md` in the skills-manager repo are the authority.
- `npx skills` interoperability after import is not promised; advise the user to manage skills through skills-manager once imported.
