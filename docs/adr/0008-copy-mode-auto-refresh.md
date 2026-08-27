# ADR-0008: Copy-mode auto-refresh of stale targets

## Status

Accepted (2026-08-26)

## Context

`skills-manager` ships two distribution modes ([ADR-0003](0003-hub-distribute-no-views.md)): `symlink` (target entries are soft links into hub `skills/<name>/`) and `copy` (target entries are a real file tree copied from hub). Projects default to `copy` ([ADR-0007](0007-project-no-in-repo-metadata.md)) because portability and git-friendliness matter more than disk savings.

The two modes behave differently under hub updates:

- `symlink` targets pick up hub edits immediately — the link target is the hub file, there is nothing to refresh.
- `copy` targets **do not**. Once the hub skill content changes (via `skills update`, `skills install --update`, or any mutation of `skills/<name>/`), every copy target silently drifts from the hub. The hub is the only authority for skill content (per ADR-0003); stale copy targets are a hidden fork.

Today there is no surfaced "drift" state and no automatic refresh. Operators either:

1. Re-run `skills distribute` by hand and remember every project they ever distributed to, or
2. Live with copy targets that quietly disagree with hub (and then wonder why the agent in a project is loading an old skill version).

Two surfaced pain points come out of this:

- **Forgetfulness.** Users update a skill, never re-distribute, ship the project, and the team gets the old behavior. There is no signal anywhere.
- **Detection without remedy.** The hub-side `distributions.jsonl` already records each target's `fingerprint` (the physical layer). We have the data to *detect* drift, but we do not expose it or act on it.

The fix has to keep the "hub is the only authority" invariant intact. The merge logic must therefore be **hub-wins, whole-tree**, not file-level diff-merge: any local file added under a managed copy target should not be silently preserved, because that would resurrect the "second source of truth" problem we already paid down in ADR-0003.

## Decision

1. **Hub is the only authority; copy targets are refreshed as whole subtrees.** Refreshing a stale copy target is: remove its managed files, write the current hub tree to the target's location. Atomic where the platform supports it (write to a sibling temp dir, then `rename` over). Local files that happen to live inside a managed target are treated as foreign and removed — copy targets are owned by skills-manager.
2. **Single refresh primitive, three call sites.** A `refreshStaleTarget(record, hubSkill)` operation is the only place that decides "is this stale?" and "how do I write the new tree?" It is called from:
   - **`skills update <skill>` / `skills install` after the hub write succeeds** — for each `copy` mode distribution record of that skill, refresh if stale (skip symlinks).
   - **`skills status` / `skills list`** — shows stale count per skill and lists stale targets.
   - **Dashboard skill row** — flags stale targets and offers a one-click refresh action.
3. **Staleness is fingerprint-only.** "Stale" = the record's stored fingerprint ≠ the hub skill's current fingerprint. We do **not** introduce a hub version field, file-level mtimes, or per-file diffing in this round. Fingerprint is already written by every distribute; this decision reuses it as a binary predicate.
4. **Single-target failures don't block siblings.** A refresh that throws (target missing, permission denied, disk full) is logged, the failing record is surfaced as `error` state in the index (not auto-pruned), and sibling targets continue. `skills status` / dashboard surfaces the error and offers a "drop distribution record" action so users can clean up records whose target path no longer exists.
5. **Trailing reminder, not nag.** `skills update` / `skills install` output, after its success line, may print a single trailing line if any stale targets remain *for skills the user did not just touch* (e.g. cross-skill staleness the operation did not cascade over, or any remaining error state). We do not print the reminder on every CLI invocation.
6. **Sync verb is not a new term.** The action is described as "refresh a stale target" — the words "sync" and "refresh" are verb phrases, not glossary entries. Glossary gains `Stale` and `Stale target` only.

## Consequences

- The `distributions.jsonl` schema gains an `error` state on a record (target refresh failed). Existing readers that ignore unknown fields keep working.
- A `RefreshStaleTarget` service is the new atomic operation; it sits beside `DistributeService` and `UndistributeService`.
- `skills update <skill>` does an extra distribution round-trip per copy target of that skill. Symlink targets cost nothing (no stale state to check, or cheap fingerprint compare that always equals). Total added latency is bounded by the slowest project I/O; this is acceptable for an explicit-update workflow.
- Removing whole subtrees on refresh is **destructive by design**. If a user has local-only files inside a managed copy target, they are lost. This is the load-bearing tradeoff: it is what keeps "hub is the only authority" intact. Users who want local files to coexist with a skill must put the skill under hub and let the hub be authoritative — the original `symlink` mode is the alternative for personal machines where that friction is acceptable.
- Dashboard's "skill library" row gains a stale indicator + refresh control. No new dashboard page.
- No new CLI command is strictly required (`skills update` cascades), but a `skills distribute --refresh` may be added later as a shortcut to refresh every stale target across all skills without going through `update`.
- The "second source of truth" risk from ADR-0003 is unchanged or improved — copy targets are still not authoritative, they are now just *less* likely to silently drift.
- CONTEXT.md gains two glossary entries (`Stale`, `Stale target`) and references this ADR.

## Alternatives considered

- **File-level diff / rsync semantics (preserve target-only files).** Rejected: resurrects the second-source-of-truth problem; users who want local files should put them in hub.
- **Watch hub for changes and auto-push to copy targets.** Rejected: introduces background processes, surprise writes into project trees that may be mid-git-operation, and conflicts with the explicit-update workflow.
- **Add a hub version field instead of fingerprint comparison.** Rejected: fingerprint already answers "is this stale?"; a version field is incremental metadata without incremental value.
- **Per-target failure rolls back the whole update.** Rejected: in a multi-project world any one project's filesystem hiccup would block all updates.
