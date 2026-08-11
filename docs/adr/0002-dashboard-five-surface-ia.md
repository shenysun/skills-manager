# ADR-0002: Dashboard five-surface information architecture

## Status

Accepted

## Context

The redesign spec defined eight primary dashboard destinations (Overview, Installed, Sources, Discover, Updates, Registry, Activity, Settings), organized largely by *verb* (discover, update, settings). The working dashboard folded this into five *object-centric* surfaces, which conflicted with the written IA and left dead routes/pages. We need an explicit product decision so implementers stop treating the eight-page map as current truth.

## Decision

- Primary navigation is exactly five surfaces: **Overview**, **Installed**, **Sources**, **Registry**, **Activity**.
- Capabilities are hosted by domain object, not by separate verb pages:
  - **By-skill update**, expose/hide, archive → Installed
  - **By-source update**, source library, **source-first install (Discover)** → Sources (Discover is a tab / deep-link, not top-level nav)
  - Language & theme → Topbar
  - Skill home, package identity, npm pack dry-run, operation + git history → Activity
- Discover UX is a **compact embedded wizard** inside Sources; multi-step chrome is optional; safety checks remain required.
- Hash contract: first-class `#/overview|installed|sources|registry|activity`; Discover deep-link `#/sources?tab=discover` (or equivalent path form). Legacy `#/discover`, `#/updates`, `#/settings` only redirect for bookmarks, then leave the model.
- Implementation must not use `localStorage` to smuggle tab selection across navigations; express state in the hash. Remove dead Discover/Updates/Settings parallel pages so each capability has one home.

This supersedes the eight-item Navigation section of `.scratch/skills-manager-redesign/spec.md`. Glossary and placement details live in `CONTEXT.md`.

## Considered options

- Keep eight top-level pages (operation centers) — rejected: lower density, duplicates object surfaces.
- Five surfaces with capability placement as in the current WIP — accepted.
- Hybrid (e.g. keep Settings as sixth nav) — rejected in favor of Topbar + Activity split already in the WIP.

## Consequences

- `/to-spec` and implementation tickets must rewrite dashboard IA against this ADR, not the original eight-page list.
- Code review Spec axis should treat missing Discover/Updates/Settings *nav items* as intentional, and treat dual homes / wrong aliases as defects.
- Overview no longer requires a dedicated git-status card; git history remains on Activity; doctor health stays on Overview.
