# ADR-0007: No in-repo metadata for project distribution

## Status

Accepted (2026-08-26)

## Context

ADR-0003/0004 shipped a dual-layer project receipt at `<project>/.skills-manager/distribute.yaml` (plus `backups/<timestamp>/` snapshots), declared "safe to commit for team visibility of what this repo uses", alongside the hub-side distribution index (`.skills/distributions.jsonl`). Inspection against the source (research: `.scratch/research/link-skill-metadata-file.md`) broke that claim:

- The receipt's `hubRoot` and `entries[].path` are **machine-local absolute paths**. On any other machine (teammate clone, CI) every path check no-ops: the only consumer (`doctor --project`) scans dead paths and verifies nothing real.
- The hub index already records every project distribution **unconditionally** (`writeRecord` runs for user and project alike; only `upsertReceipt` is project-only). The in-repo receipt is a redundant local copy, not a distinct source.

The usage model surfaced in the grill: collaborative projects use `copy` — git is the sync channel, contents in git already reach teammates; personal projects use `symlink` — which the hub index already records. Neither path needs an in-repo manifest.

## Decision

1. **Delete the in-repo `.skills-manager/` directory entirely** (receipt + backups). Project distribute writes only the hub index.
2. **Project applies take no snapshots.** git is the project's restore point. `distribute rollback` on a project target errors (`project rollback not supported`); rollback is user-scope only (hub-side stash under `.skills/distribute-backups/`).
3. **Collaboration model (zero code):** git is the shared channel; distribution authority stays with the first distributor; teammates are pure consumers (committed contents load directly); the C1 foreign-refusal on their machines is protection, not a bug; takeover requires explicit `--force`.
4. **Project default mode stays `copy`** (the safe side; symlink remains an explicit personal-machine choice and its products are not portable).
5. **Pre-publish break, not migration:** the v2 receipt schema, `doctor --project` receipt scan, migrate-consumers' receipt leg, and the receipt tests are deleted outright (zero external users; precedent: ADR-0004's no-baggage break).

## Consequences

- `doctor --project` flag is removed with the receipt scan; doctor's managed/foreign accounting is hub-index only.
- `undistribute` (project) works from the hub index as single source; `syncReceiptFromRecord` and rollback's receipt round-trip are deleted.
- The hub index is now the **only** distribution record for both scopes: hub loss loses all distribution records. Mitigation: keep the hub git-managed (doctor already reports hub gitStatus).
- Teammates' machines hold no record of committed skills — accepted by the collaboration model.
- CONTEXT.md L1/U1 revised; the "Distribution receipt" glossary term is replaced by the hub-only "Distribution index".
