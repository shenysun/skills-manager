# ADR-0006: `init` reverse-imports runtime skills into the hub with back-symlinks

## Status

Accepted (2026-08-25)

## Context

Users arrive with skills already installed in agent runtime directories (`~/.claude/skills`, `~/.cursor/skills`, …). The hub-first model (ADR-0003) had no onboarding path for them: either the hub starts empty next to a pile of unmanaged skills, or users hand-move directories. Imported skills also carry unknown provenance (hand-written vs downloaded from GitHub) — skills-manager cannot know or manage their upstream.

## Decision

1. **`init` is the exact reverse of distribute.** It scans only the global runtime directories (`globalSkillsDir`) of detected catalog agents — no parallel location lists, no custom heuristics. Same catalog, same paths, opposite direction.

2. **Entities move into the hub; runtimes become back-symlinks.** Skill content is copied into hub `skills/<name>/`; each originating runtime path is replaced by a symlink pointing back at it (same direction as user-distribute symlinks). One canonical copy; every tool keeps loading from its familiar path.

3. **Non-interactive conflict protocol.** The CLI stays non-interactive: conflicts are skipped and reported with a copy-paste re-run command (`--resolve <skill>=<agent-id|hub>`). `--all` skips all conflicts (hub wins hub-vs-runtime conflicts). Rich per-conflict selection lives in the dashboard (inline dropdowns, submitted as the same resolve map). Multi-location name clashes: the chosen version enters the hub and **all** clashing locations symlink to it.

4. **Safety.** A runtime directory is moved to hub `.backups/<name>-<timestamp>/` before its path becomes a symlink (move = backup + vacate in one step). Backups expire after 30 days; `backup list` / `backup restore <skill>` provide self-service rollback. A per-skill failure restores that skill's prior state and processing continues; symlink failures never degrade to copies.

5. **Registry honesty about provenance.** Imported entries carry `imported: true` and **no** source — no `imported_from`, no guessed URLs. Skills-manager does not manage their updates. Staleness stays visible: doctor lists imported-without-source skills, and `edit <skill> --source-url` upgrades one into the normal update flow once the user supplies the truth.

6. **Idempotent.** A runtime path already symlinked to the hub skill is skipped; re-running `init` is always safe.

## Consequences

- Registry model gains an `imported: true` field; doctor gains an imported-staleness section; `edit` gains source-supply flags.
- Init-created symlinks are recorded in the distribution index so doctor/undistribute treat them as managed, not foreign.
- Users may edit a skill from any symlinked location — transparency is a feature, not a hazard.
- Backup directories are a recovery aid, never a second skill store.
- Dashboard needs an import entry (empty-state card + standing button) calling the same InitService.
