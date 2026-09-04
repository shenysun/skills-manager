# Skills Manager CLI

**English** | [简体中文](CLI.zh-CN.md)

`skills-manager-cli` provides the `skills-manager` executable for a local-first skill home.

## Skill home resolution

Priority:

1. `--home <path>`
2. `SKILL_HOME`
3. the current working directory when it already contains `skills/`, `views/`, `collections/`, and `registry.yaml`
4. `~/.skills-manager`, which is initialized automatically

Initialization creates `skills/`, `views/`, `collections/`, `registry.yaml`, and the parent directory for `.skills/activity.jsonl`.

## Commands

```sh
skills-manager web --home ./my-skill-home
skills-manager doctor --home ./my-skill-home
skills-manager catalog info --home ./my-skill-home
skills-manager catalog refresh --home ./my-skill-home
skills-manager list --home ./my-skill-home
skills-manager add <source> --all --yes
skills-manager update --plan
skills-manager update --skill my-skill
skills-manager update --source '<source-key>'
skills-manager distribute --to user --skill my-skill --agent claude-code --agent zed
skills-manager distribute --to project --project ./repo --skill my-skill --agent cursor --mode copy
skills-manager undistribute --to user --skill my-skill --agent claude-code
skills-manager redistribute --outdated
skills-manager redistribute --refresh --to project --project ./repo
skills-manager status
skills-manager init --dry-run
skills-manager init --agent claude-code --agent cursor
skills-manager init --prefer claude-code ~/.agents/skills hub
skills-manager init --resolve my-skill=cursor --resolve other-skill=hub
skills-manager backup list
skills-manager backup restore my-skill
skills-manager edit my-skill --source-url https://github.com/owner/repo
skills-manager archive old-skill
skills-manager rebuild-collections
```

Distribute targets any catalog agent id (`--agent`, repeatable). Omitting `--agent` applies to the detected set on this machine. User scope defaults to `--mode symlink`, project scope to `--mode copy`; one mode per apply.

### Stale copy targets and auto-refresh (ADR-0008)

`copy`-mode targets drift from the hub when skill content changes; symlink targets always proxy the live hub tree and never go stale. Staleness is fingerprint-only, and refreshing replaces the whole managed subtree (files local to a managed copy target are not preserved — the hub is the single authority).

- `add` / `update` **cascade**: after the hub write succeeds, every stale copy target of the touched skills is refreshed automatically; per-entry failures are recorded on the index entry and never block siblings.
- `skills-manager status` prints `outdated: N, errored: M`, lists refresh errors with their runtime paths, and points at the fix command.
- `skills-manager redistribute --refresh` (alias of `--outdated`) refreshes every stale copy target, optionally filtered by `--to` / `--project`; it prints `Refreshed N, errored M.`
- `add` / `update` print a one-line trailing reminder when other stale targets remain.
- The dashboard shows a stale badge with a count and a one-click refresh button per skill row.

### init (reverse import)

`init` is the reverse of distribute: it scans the **global runtime directories of detected catalog agents** (`~/.claude/skills`, `~/.cursor/skills`, …), imports discovered skills into the hub, and turns each origin into a managed symlink back to `skills/<name>/` (the original is moved to `<home>/.backups/` first; backups expire after 30 days). Imported entries are stamped `imported: true` with no source — Skills Manager never guesses provenance. The CLI is non-interactive: clashing skills are skipped unless this run declares a **conflict priority** (`--prefer <runtime-dir|agent-id|hub...>`) or a per-skill `--resolve`. The first `--prefer` source that actually holds a copy wins; `--resolve` overrides it for that skill. Identical full trees are one entity, not a clash. Prefer items must be `hub` or a directory scanned this run. The dashboard import sheet is the same list. See [ADR-0006](adr/0006-init-reverse-import-symlinks.md) and [ADR-0009](adr/0009-init-conflict-priority.md).

## Agent catalog snapshot

The agent table (ids, runtime paths, detection rules) ships as a bundled snapshot extracted from [vercel-labs/skills](https://github.com/vercel-labs/skills) (MIT; attribution inside the file). `skills-manager catalog info` shows the snapshot stamp (upstream commit, date, age) and the detected agent set — the same determination `npx skills` makes with no `-a`. `skills-manager catalog refresh` re-downloads upstream, re-extracts, and stores the newer snapshot as a hub-local override at `<home>/.skills/agent-catalog.json`; doctor warns when the effective snapshot is older than 90 days.

To regenerate the checked-in snapshot during development: `pnpm run catalog:extract` (downloads `src/agents.ts` + `src/detect-agent.ts`, extracts, writes `src/core/catalog/agent-catalog.json`).

`<source>` can be a GitHub shorthand (`owner/repo`), Git URL, GitHub tree URL, or local path.

## Dashboard

```sh
skills-manager web --home ~/.skills-manager
skills-manager web --no-open
```

The dashboard serves a local Vue/Vite UI backed by Fastify routes. Mutating dashboard operations write activity records to `.skills/activity.jsonl` and leave disk changes visible for `git diff`.

## Development

```sh
pnpm install
pnpm run build
pnpm test
```

The test suite includes compiled-artifact coverage: `tests/cli/cli-bin.test.ts` boots `dist/cli.js` as a real subprocess (home resolution, help, migrate-views), and `tests/package/package-smoke.test.ts` packs the tarball, installs it into a temp dir, and drives the installed bin plus the dashboard API.
