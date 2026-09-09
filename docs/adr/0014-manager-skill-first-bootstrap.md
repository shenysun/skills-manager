# ADR-0014: Manager-skill-first — npx bootstraps only the manager skill

## Status

Accepted (2026-09-09; repositions the product relative to ADR-0005's dashboard focus — 0005 stays valid for what the dashboard is, this ADR decides what the dashboard is *for*)

## Context

The product grew three interfaces: a web dashboard (the README hero), the CLI, and the official manager skill (installed manually via a two-step GitHub `add` + `distribute`). Real usage showed the dashboard losing on both axes a primary interface must win: it trails the CLI in coverage, and its first screen answers no question the user arrived with ("打开不知道要干嘛"). Meanwhile every dashboard capability is a CLI capability, and the manager skill already wraps the full CLI surface. The operator decided the agent conversation — not a page — is the natural home for skill management.

## Decision

**The manager skill is the primary interface. `npx` exists only to make the conversation possible.**

1. **Bootstrap.** `npx skills-manager-cli` with no subcommand runs a one-time, idempotent bootstrap: ensure the hub, seed the manager skill into it from the bundled package copy, mount it (symlink) into the operator's chosen agents, print one starter prompt. It imports nothing — even when existing runtime skills are detected, importing stays a conversational act performed later through the manager skill.
   - TTY: multi-select of **detected** agents only, default all checked; `--agent` bypasses the prompt. Non-TTY: all detected agents. No agent detected: still create the hub and seed the skill, then print the mount hint.
2. **Everything else happens through the manager skill in agent conversation** (import, install, distribute, update, provenance). The skill invokes `npx skills-manager-cli <cmd>`; it does not assume a global install.
3. **Seeding and upgrades.** The manager skill is seeded offline from the bundled copy; the publish flow stamps its source (repo/ref/tree SHA) into the registry so normal tree-SHA update detection applies. Every CLI run self-checks the bundled copy against the hub copy and silently refreshes it unless the operator has modified the hub copy (then it is foreign — untouched, surfaced by doctor).
4. **No auto-mount beyond bootstrap.** Later distributes never silently add the manager skill to new agents; mounting it elsewhere is an explicit conversational request.
5. **README and entry points.** Hero = the no-arg bootstrap, then the starter prompt. The `npm install -g` section is demoted to a tail note; `web` is demoted to a late one-paragraph alternative; `web` loses its first-run hub-creation side effect (it prompts to bootstrap first); the GitHub two-step for installing the manager skill is deleted from docs.

## Considered options

- Keep the dashboard as hero, improve it to parity — rejected: it would have to win on coverage *and* simplicity while the conversation interface already wins both by construction.
- Interactive full-setup `init` (bootstrap + agent selection + import in one go) — rejected: bootstrap must do the minimum that makes conversation possible; importing at first run re-creates the "many questions before value" problem.
- Mount the manager skill to every agent the operator ever opts into (auto-include on distributes) — rejected: surprise writes contradict explicit live wiring; explicit conversational requests are cheap.
- Seed the manager skill from GitHub `add` — rejected: needs network on first run and treats the product's own skill as an external dependency; bundled seed with a publish-time source stamp gets provenance without the network.

## Consequences

- The CLI gains its first interactive moment (the bootstrap multi-select); the "CLI entirely non-interactive" note in SKILL.md is amended — flags remain the non-interactive path.
- The CLI is repositioned as an engine; the dashboard as optional visualization. Neither gets removed.
- SKILL.md gains a first-run/empty-hub guidance section so the first conversational turn doesn't assume prior concepts; deeper conversational polish is tracked separately.
- Single entry point becomes a invariant: no other command may create the hub implicitly (`web`'s side effect is removed accordingly).
