# ADR-0012: Agent-assisted, user-approved provenance backfill

## Status

Accepted (2026-09-05)

## Context

After [ADR-0011](0011-init-adopts-lockfile-evidence.md), three cohorts remain source-less: hand-copied or user-written skills (no evidence anywhere), skills whose lock entries carry no usable evidence, and — a structural gap ADR-0011 left — **legacy imports**: evidence adoption ran only on the fresh-import write path, so skills imported before ADR-0011 could never pick up the lockfile evidence they already had. On this machine that legacy queue is real: 72 registry entries, 20 with `source: {type: local, url: null}`.

Meanwhile, the place skills-manager actually gets operated is an **agent session**: the user talks to a coding agent, the agent drives the CLI. Two capabilities make a full backfill workflow possible now:

1. Deterministic evidence backfill — re-run the ADR-0011 adoption over the legacy queue (`provenance adopt`), same gate, no guessing.
2. Candidate discovery — the open skills ecosystem (`npx skills find` against skills.sh, GitHub code search for `SKILL.md`) returns *candidates* with quality signals (install counts, repos). A candidate is **not evidence**. ADR-0011's prohibition was guessing; a user looking at verified candidates and choosing one is not guessing either.

`edit` could only write `url`/`ref`, never `subpath` — so even an approved upstream could not enter the update flow. That gap closed in this same effort.

## Decision

1. **Backfill is a three-layer workflow, evidence-ordered.** Layer 1 (deterministic, automatic): `provenance adopt` re-applies lockfile evidence to the legacy imported queue — no user interaction. Layer 2 (guessing, agent-driven): for what remains, an agent reads the skill's name/description, searches the ecosystem (primary: `npx skills find <query>`; fallback on empty results or network failure: GitHub code search for `SKILL.md`), and **verifies** candidates by comparing the upstream SKILL.md's name/description against the local copy. Layer 3 (approval, user-only): each skill is presented as an in-session choice — verified candidates with quality signals, "confirm locally authored", or "skip".

2. **A guessed source is never written without the user's explicit per-skill approval.** ADR-0011 constrains *automatic* flows (init, adopt): they adopt evidence or stay silent. Layer-2 candidates flow through `edit --source-git <owner/repo> --subpath <path>` only after the user picks them. This is the boundary between ADR-0011 and this ADR: evidence is adopted, candidates are approved.

3. **"Confirm locally authored" keeps the honest snapshot.** No source is written; the skill stays `{type: local, url: null}`. Never a fabricated upstream.

4. **The workflow ships as the official agent skill** (`skills-manager` SKILL.md in this repo): task-oriented coverage of the whole CLI surface plus this backfill workflow, including the dual search channels, the verification step, and the when-to-ask rule (act autonomously on evidence; ask before any guessed write). The skill is discoverable by source-first install, so the manager documents itself through its own model.

5. **Approved sources land in the `add`-shaped form** (type/url/subpath, optional ref) and enter the update flow immediately; without commit/baseline anchors, update's fetch-and-diff remains the safety net.

## Non-goals

- Fingerprint-based automatic source suggestion (ADR-0011's Avoid stands).
- Writing any guessed source without per-skill user approval.
- A durable "user confirmed locally authored" marker — v1 expresses it as the local snapshot itself; a persistent marker (activity-log record or registry field) is a follow-up if re-asking becomes annoying.
- A dashboard approval UI; the approval happens in the agent session.
- skills.sh search wrapped as a CLI command — search stays an agent-session concern; the CLI keeps no network capability beyond git clone and catalog refresh.

## Consequences

- The legacy-evidence gap is closed by `provenance adopt`; doctor's imported-without-source list now means "no evidence and not yet user-resolved".
- `edit` writes complete git sources (URL normalization shared with `add`); source validation only converts explicitly provided keys, so merges never clobber recorded anchors with `undefined`.
- The CONTEXT.md glossary gains the backfill vocabulary (pending queue, adopt, approval semantics).
- ADR-0011's non-goal wording is sharpened, not reversed: *automatic* fingerprint suggestions remain out; agent-found, user-approved candidates are a new, explicit path.
