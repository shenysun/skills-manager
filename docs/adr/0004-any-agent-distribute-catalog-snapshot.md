# ADR-0004: Any-agent distribute via a bundled catalog snapshot

## Status

Accepted

## Context

ADR-0003 shipped distribute, but the implementation still targets the legacy closed pair (`agents`/`claude`) with hard-coded `~/.agents/skills` and `~/.claude/skills` paths, while the ratified glossary names the vercel-labs/skills agent table (73 agents; ~30 sharing `.agents/skills`; only `eve` and `promptscript` are project-only; MIT-licensed, table lives in upstream `src/agents.ts`, not as a standalone module in the npm package) as the only catalog. Research notes: `.scratch/agent-catalog-distribute/research-agent-catalog.md`.

Three tensions had to be resolved: how to know the catalog without runtime network or shelling out to `npx skills`; how "detected" stays consistent with `npx skills` without a second heuristic; and how receipts account for many agents mapping to one shared directory.

## Decision

1. **Bundled catalog snapshot + explicit refresh.** The agent table (ids, global/project paths, detection rules) ships as a versioned data file inside the package, stamped with upstream commit and date; `catalog refresh` pulls a newer one. No runtime fetching, no shelling out. Doctor reports snapshot age.

2. **Detection is data, not code.** Detection rules travel inside the snapshot; the same rule runs locally against the same data, so skills-manager and `npx skills` cannot drift apart except by snapshot staleness (surfaced, fixable by refresh). Detected is only a default (CLI target when no `--agent`; first-open picker checks) — never a gate.

3. **Dual-layer receipts.** Each receipt entry records a physical layer (path, mode, fingerprint, managed marker) — the layer undistribute/outdated/foreign-refusal operate on — and a logical layer (the agent ids that motivated the write) for provenance and display. Shared-path undistribute is reference-counted: the physical entry is deleted only when its last referencing agent is removed.

4. **No-baggage legacy break (pre-publish).** The package is unpublished with zero external users, so legacy surface is deleted, not aliased: `--consumer` flag and `expose`/`hide`/`rebuild-views` commands are removed; the loader hard-fails on legacy `agents`/`claude` registry tags. A single `migrate-consumers` command (dry-run + rollback) rewrites `registry.yaml` and existing hub receipts/index, using the identity-preserving mapping `claude` → `claude-code`, `agents` → all catalog ids whose global path is `~/.agents/skills`. The expansion makes registry.yaml verbose; accepted as data honesty.

5. **Scope before agents.** User/project remains orthogonal to agent selection and is chosen first; the agent picker filters validity per scope, graying project-only agents with a reason on user scope.

6. **Picker and display are physical-first.** Picker: search + 已检测/全部目录 sections, family select-all as pure UI sugar over an agent-id selection, one mode selector per apply (user→symlink, project→copy defaults), per-scope memory equal to the last confirmed apply. Display: badges per physical target with agent drill-down; Overview shows managed-entry count plus unique agent coverage; doctor scans only paths known from the hub index or the active project receipt.

## Consequences

- `CONSUMERS = ['agents','claude']` and all count fields/badges/UI keyed on it are removed from the model; runtime entry accounting moves to receipt physical entries.
- A snapshot extraction step enters the build/release process and must carry MIT attribution; upstream catalog growth requires refreshing the snapshot to reach new agents.
- `migrate-consumers` must be robust (dry-run, rollback) because it is the only bridge from legacy hubs; after migration no translation code remains.
- Deleting `--consumer`/`expose`/`hide`/`rebuild-views` breaks any local scripts using them — acceptable only while unpublished; revisit policy before any public release.
- Receipt schema change means existing hub index data needs the same one-shot migration, not ad-hoc reads.
