# ADR-0003: Hub storage, distribute to runtimes, no views tree

## Status

Accepted

## Context

Skills must be managed in one place (cross-project reuse, single update point) while still reaching real agent runtimes for users and projects. Intermediate hub `views/<consumer>/` trees duplicated expose state and added symlink hops. Copy-only or symlink-only strategies each fail half the world (disk/portability vs teammates without the same hub path). Dual full skill homes as two sources of truth forked the same skill identity.

## Decision

1. **Canonical hub** — Skill content lives only in a skill home/hub (default `~/.skills-manager`: `skills/`, `registry.yaml`, optional `collections/`, distribution index under `.skills/`). Install, update, and archive run only against the hub.

2. **Distribute** — Selected hub skills are published to **distribution targets**:
   - User: `~/.agents/skills/<name>`, `~/.claude/skills/<name>`
   - Project: `<project>/.agents/skills/<name>`, `<project>/.claude/skills/<name>`
   - Only chosen consumers receive entries.

3. **Modes** — Distribute supports **`symlink`** (direct link to hub `skills/<name>/`) and **`copy`** (materialize that tree). Defaults: **user → symlink**, **project → copy**; overridable per operation. Symlink is local-only; copy is the portable/git-friendly path for teammates without skills-manager.

4. **No hub `views/`** — Do not use or require `views/agents` or `views/claude` as an expose layer. Symlinks do not hop through views. Legacy expose/hide/rebuild-views map to distribute/undistribute (or aliases). **`collections/` remains** for category browsing only, not consumer loading.

5. **Receipts** — Project: `<project>/.skills-manager/distribute.yaml`. Hub: distribution index (e.g. `.skills/distributions.jsonl`). Runtime dirs stay skill entries only.

6. **Safety & lifecycle** — Managed vs foreign paths (foreign refuse without force). Fingerprints, outdated detection, idempotent re-distribute, rollback to last successful apply. Live runtime writes only via distribute.

Glossary and full quality bar live in `CONTEXT.md`.

## Consequences

- Implementation must migrate off view-service-centric expose; doctor metrics based on view link counts need redesign around runtime + receipts.
- Existing hubs with `views/` need a migration/ignore path when distribute ships.
- Dashboard/CLI gain distribute, status/outdated, rollback; Installed “expose” becomes distribute UX.
- Project git may contain copied skills under `.agents`/`.claude` plus a small distribute.yaml; authors re-distribute after hub updates.
- Harder to reverse than a pure UI change: filesystem layout and user workflows depend on R1 paths and no-views policy.
