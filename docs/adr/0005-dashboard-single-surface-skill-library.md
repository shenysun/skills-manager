# ADR-0005: Dashboard single-surface skill library

## Status

Accepted (supersedes ADR-0002)

## Context

ADR-0002 collapsed eight dashboard pages into five object-centric surfaces. After the any-agent distribute release, the operator's measured daily line is only: distribute to agents/projects, remove, install, update — all centered on one object, the skill. Three of the five surfaces (Overview, Registry, Activity) saw no real use, and every layer (IA, page density, visuals) reads as too complex. The operator asked for a minimal product and confirmed the cut.

## Decision

The dashboard shrinks to a single surface — the **skill library** — plus two entries:

- **Skill library** (the only page): every hub skill is a row with in-place actions — 接入 (opens the any-agent picker), update, remove. Search/filter stay; category and batch tooling collapse into row overflow.
- **+ 添加技能** (top-right): opens the source-first install wizard. The Sources surface disappears; the wizard survives.
- **日志** drawer (top-right): the operation log survives as a drawer. The Activity surface disappears.

Explicit cuts: **Overview** (doctor signal becomes per-row status marks), **Registry editor** (no dashboard surface; `registry.yaml` remains the metadata backbone, edited by hand or CLI), **Activity page** (log drawer only). There is no update center, no primary navigation, and no Settings.

## Considered options

- Keep the five surfaces, reduce per-page density and visuals only — rejected: three surfaces had no real usage; the navigation itself was the complexity.
- Single-surface skill library — accepted.

## Consequences

- Dashboard routing collapses; all legacy hashes redirect to the single page.
- Registry field edits leave the product UI. If a real need re-emerges, it re-enters as a focused affordance, not a page.
- The any-agent 接入 picker, dual-layer receipts, conflict policy, and distribution semantics are unchanged — this ADR reshapes surfaces only, not the distribute model.
