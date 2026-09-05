# ADR-0011: Init adopts `npx skills` lockfile evidence for provenance

## Status

Accepted (2026-09-05)

## Context

[ADR-0006](0006-init-reverse-import-symlinks.md) decided imported skills carry no source, on the premise "skills-manager cannot know their upstream". That premise is false for one large cohort: skills installed by the `npx skills` CLI. Upstream keeps a machine-global lockfile — `~/.agents/.skill-lock.json`, or `$XDG_STATE_HOME/skills/.skill-lock.json` when set (version 3, centralized; agent selection does not change its location) — whose entries record `source`, `sourceType`, `sourceUrl`, `ref?`, `skillPath`, `skillFolderHash`, and install timestamps.

Two facts reshape ADR-0006's stance:

1. `skillFolderHash` is a **Git tree SHA taken from the upstream side** (GitHub Trees API, or `git rev-parse HEAD:<dir>` from a shallow clone) — not something computed locally. It is the only anchor to "what upstream version was installed"; the lock has no commit SHA.
2. On this machine the lock holds 44 entries, all `sourceType: github`, all with `skillPath`; 33 overlap skills already imported into the hub — roughly half the imported population. Evidence-based adoption is not a corner case.

ADR-0006's real prohibition was **guessing** upstreams (fingerprint-matching suggestions). Reading evidence the user already has is not guessing.

## Decision

1. **Init parses the global lockfile and inherits provenance.** For each imported skill whose name matches a lock entry, the registry records a real source instead of a source-less snapshot; the skill enters the normal update flow immediately. `imported: true` stays (it marks *how the skill entered*; source marks *update eligibility* — orthogonal, already the de-facto shape after `edit --source-url`).

2. **Inheritance scope is `sourceType` ∈ {`github`, `git`, `local`}.** `github`/`git` map to `{ type: git, url: sourceUrl, subpath: skillPath minus trailing /SKILL.md, ref: lock ref ?? null }`. `local` maps to `{ type: local, url: sourceUrl }` — a local source's path **is** its identity: with url+subpath recorded, update and doctor treat the skill like any sourced one (update re-copies from the local path), and a local entry without a sourceUrl degrades to an audited snapshot. All other source types (`mintlify`, `huggingface`, `well-known`, `node_modules`) are treated as no-evidence snapshots: skills-manager's source model only understands git/local, and a recorded-but-unupdatable source is worse than an honest snapshot.

3. **`skillFolderHash` is inherited as `baseline_hash`** on the source record (registry's snake_case, matching `upstream_commit`) — the upstream tree SHA at install time. Update uses it for fast changed-detection (fetch upstream tree SHA, compare against baseline) before any full-tree diff. Local hand-edits are **not** detected via local hashing (tree SHAs are not locally reproducible without the repo); they surface naturally in update's file-level diff, which warns that updating overwrites local changes (originals recoverable from backup).

4. **Discovery is fixed, not scanned.** One file: `$XDG_STATE_HOME/skills/.skill-lock.json` if `XDG_STATE_HOME` is set, else `~/.agents/.skill-lock.json`. A lockfile that is absent, malformed, or not schema v3 is ignored entirely (upstream itself wipes pre-v3 locks on read; an unknown future schema is ignored rather than guessed at). Entries without `skillPath` count as no evidence. Orphan entries (locked but absent on disk — e.g. leftover `plugin:skill` names) are never reached by init's scan and are thus ignored. Matching is by skill name.

5. **Update anchoring is HEAD-tracked, content-diff based.** `ref: null` follows the default branch; update fetches the upstream tree and diffs against hub content. No commit pinning at import — init stays offline and non-blocking.

6. **No lockfile maintenance.** Skills-manager never deletes, rewrites, or syncs the user's `.skill-lock.json`, and promises no `npx skills` interoperability after takeover. Running `npx skills update` afterwards may follow symlinks and bypass the single-writer principle — that is the user's responsibility, documented.

7. **Non-goals.** Fingerprint-based source suggestions for no-evidence skills (manual `edit --source-url` remains the only path). The project-level lock `./skills-lock.json` (version 1, git-commit-friendly, lives in project cwd) — project skills belong to the copy+git collaboration model of [ADR-0007](0007-project-no-in-repo-metadata.md). Any UI distinction for imported skills: once sourced, they render exactly like add-installed ones.

## Consequences

- ADR-0006 decision point 5 is amended: "no source" becomes **"no guessed source; adopt evidence when present"**. Its decision structure (reverse-import, symlinks, backups, conflict protocol) is untouched.
- Registry source records gain an optional `baseline_hash` field; `add` installs may write the same field later, unifying the baseline concept. Adoption ships first: this change records the field, and update's tree-SHA fast-path comparison lands as its own follow-up (until then update keeps its fetch-and-diff flow, correct but without the fast path).
- Init-service gains one file parse; no network, no new CLI flags.
- Doctor's imported-without-source list now genuinely means "no evidence found" — a smaller, honest cohort (hand-copied and user-written skills).
- The CONTEXT.md "Import (init)" glossary entry is updated: `imported` = entry method, `source` = update eligibility, evidence adoption on import, lockfile untouched.
