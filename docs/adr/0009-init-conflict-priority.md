# ADR-0009: Init conflict priority (per-import ordered sources)

`init` (ADR-0006) skipped every name clash and required a per-skill `--resolve`. Operators with the same skill in several runtime directories had no way to say “this run, prefer that directory” without repeating the flag. A built-in “Claude wins” default would guess; a hub-stored preference would silently reuse last week’s choice.

**Decision:** each import may declare a **conflict priority** — an ordered list of sources for **this run only**. A source is a scanned **runtime skill directory** (named by path or by any catalog agent that loads it) or `hub`. The first source that actually holds a copy of the conflicting skill wins; per-skill resolve still overrides. No declared list means no guess. Byte-identical full trees are one entity, not a clash. Every prefer item must be `hub` or a directory scanned this run, otherwise the command fails. CLI: `--prefer <item...>`; `--all` is deleted (it never did what it claimed). Dashboard import sheet is a **first-class** surface for the same list (orderable sources + per-row override), submitted to the same `InitService`.

_Avoid_: agent-family as a priority unit; persisting the list on the hub; a product-level Claude default.
