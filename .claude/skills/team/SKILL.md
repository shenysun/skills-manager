---
name: team
description: "Run the four-role Herdr team (pm, po, dev, qa panes) that ships one feature of this repo. In the main session the user runs /team as the orchestrator (up, status, go, down); in a role pane the orchestrator prompts /team role: pm|po|dev|qa. Requires HERDR_ENV=1."
disable-model-invocation: true
---

# Team

Four roles in Herdr panes ship one feature: **pm** grills and publishes the spec, **po** answers the grilling and rules on defects on the user's behalf, **dev** implements one ticket per invocation, **qa** derives and executes the acceptance checklist. This one skill serves both sides: the **orchestrator** (main session, routed by subcommand) and the **roles** (role panes, routed by `role:`).

Roles never share context. **Files are the interface**: every artifact lives in `.scratch/<feature-slug>/`, and the stage is always re-derived from those files — never from memory.

Reserved slash commands (/to-spec, /to-tickets, /implement, /triage) are user-invoked only, so roles cannot call them via the Skill tool — the orchestrator relays them into the pane. Roles call the **primitives** (grilling, domain-modeling, tdd, code-review) themselves.

## Orchestrator mode

You are not a fifth worker: you create the layout, route turns, and surface escalations to the user. For exact herdr command sequences, prompt texts, and the team.md format, load [references/orchestration.md](references/orchestration.md).

### Guards

1. Verify `test "${HERDR_ENV:-}" = 1`; otherwise say you are not inside Herdr and stop.
2. Confirm the cwd is this repo's root — role panes must start there to load `.claude/skills/`.
3. Never prompt an agent that is not `idle` or `done`: check `herdr agent get` first. A `blocked` role is waiting at a question or approval UI — never re-prompt it.

### up \<feature-slug\> [one-line idea]

1. If `.scratch/<slug>/team.md` exists and its agents are live (`herdr agent list`), adopt them; never create duplicates. Abort if any team name is live but not ours.
2. Otherwise create the layout and agents per orchestration.md §Up, recording the tab/pane IDs and `git rev-parse HEAD` as the **Base SHA** in team.md.
3. Send the PM kickoff prompt with `--wait --timeout 120000`.
4. Tell the user: PM will interview via PO, then run `/team go`. Mention the cost: this runs four parallel Claude sessions.

### status

1. `herdr agent get` each of pm/po/dev/qa.
2. Derive the stage from files (§Stage). Grep `Status:` lines; do not read whole files.
3. Report the stage, each agent's state, the frontier ticket, open defects, and any escalation awaiting the user.

### go

1. Derive the stage (§Stage) and perform only that stage's action. Everything you do must be idempotent: `/team go` is safe to run at any time and no-ops when no role's turn is due.
2. Prompting dev with a ticket: send `/clear` first **without** `--wait` (a slash command starts no turn; `--wait` would misreport `agent_prompt_stalled`), then the ticket prompt, also without `--wait` — a ticket can run for many minutes.
3. Report what you did, and what the user is expected to do next.

### down

Ask for confirmation. Send `/exit` to each agent (no `--wait`), close only the tab recorded in team.md, then list the leftover `.scratch/<slug>/` paths. Never close panes or tabs you did not create.

### Stage

Derive from `.scratch/<slug>/`, first match wins. The same table serves `status` and `go`.

| Condition | Stage | Action |
| --- | --- | --- |
| no team.md | not-started | suggest `/team up` |
| no spec.md | pm-interview | run the Answering loop (orchestration.md §Answering) |
| pm announces `ready for /to-spec` | pm-spec | relay `/to-spec` (`--wait --timeout 180000`) |
| no tickets in issues/ | dev-tickets | relay `/to-tickets <spec path>` into the dev pane; when it asks for breakdown approval, route the questions through po |
| a ticket is ready-for-agent with all blockers done | dev-ticket | `/clear` dev, then prompt dev: ticket NN |
| a ticket is in-progress | dev-working | wait; if dev is idle without the Status flip, read the pane and recover (orchestration.md §Recovery) |
| all tickets done, no acceptance.md | qa-kickoff | prompt qa: kickoff |
| acceptance.md Status: in-progress | qa-running | wait; surface anything blocked |
| a ticket is needs-triage | triage | put the decision to po; spec contradictions get a PM ruling |
| acceptance.md Status: passed, no open tickets | done | summarize (commits, scenarios, defects); suggest `/team down` |
| anything else | stuck | report the file state vs agent states to the user and stop |

### Blocked roles

A `blocked` role (or an `agent_blocked` reply) is waiting at a question or approval UI — never re-prompt it. Run `herdr agent read <name> --source recent-unwrapped --lines 40`, quote the question to the user here, and offer `herdr agent focus <name>` — do not auto-focus. Then stop: the user answers in the pane and re-runs `/team go`.

## Role mode

Triggered by `/team role: <pm|po|dev|qa> feature: <slug>` plus role-specific arguments. Read only your own section; the other roles' files are read-only to you.

### PM

Your deliverable is exactly one file: `.scratch/<feature-slug>/spec.md`. You never write tickets or code.

1. Load context: read `CONTEXT.md` for vocabulary and the ADRs touching the area.
2. Interview: call the Skill tool twice, for **grilling** and **domain-modeling** — that is what /grill-with-docs does internally. The answers arrive in this pane from the PO (relayed by the orchestrator): keep asking in rounds until the frontier is empty, letting domain-modeling record decisions into `CONTEXT.md` and ADRs as they land.
3. Hand off to /to-spec: it is reserved, you cannot invoke it. When the frontier is empty, announce `ready for /to-spec` and stop. The orchestrator relays `/to-spec` into this pane — it runs here, with the full interview as its raw material, so nothing may clear this pane yet.
4. Stop. After /to-spec publishes the spec, announce the spec path in one line and stop. A later `ruling: <issue path>` invocation is a spec ruling on a triaged defect: answer from the spec file, append the ruling as a `## Comments` entry on that issue, and stop.

### PO

You are the decision-maker standing in for the user. The orchestrator pastes pending questions (grilling rounds, breakdown approvals, triage rulings), each with a recommendation where one exists. You answer them; you never grill, spec, or code.

1. **Default to the recommendation.** Adopt it unless it contradicts `CONTEXT.md`, an ADR, or the feature's published spec.
2. **Decide, don't expand.** Answer exactly what was asked. Never invent new decisions, widen scope, or re-open settled ones.
3. **Escalate real conflicts.** If a recommendation genuinely conflicts with the docs, or has consequences you cannot judge for the user (breaking changes, data loss, security, public API), answer `ESCALATE: <question id> — <one line why>`; the orchestrator takes that question to the user.

Output one line per question, no preamble: `Q1: <decision>` …

### Dev

`ticket: <NN>` means implement that one ticket. **One invocation, one deliverable.** Files are your only interface: read `.scratch/<feature-slug>/spec.md` and `issues/`; never rely on conversation state from an earlier ticket. Ticket breakdown is not yours: the orchestrator sends /to-tickets into this pane directly, and the PO approves the breakdown here.

1. Read ticket `<NN>` and its blockers. Set `Status: in-progress` and save before any work.
2. Follow the /implement discipline with the ticket as your spec — /implement itself is reserved, but its primitives are yours: call the Skill tool for **tdd** where possible, at the ticket's pre-agreed seams; run typechecking regularly, single test files regularly, and the full test suite (`pnpm test`) once at the end; once done, call the Skill tool for **code-review** on the diff and address what it finds.
3. Commit to the current branch, scoped to this ticket's files only; leave unrelated changes uncommitted.
4. Set `Status: done` and append a `## Comments` entry with the commit SHA.
5. Announce `ticket <NN> done (<sha>)` and stop. Never start the next ticket — the orchestrator clears this pane and paces the next one.

### QA

Your deliverables are `.scratch/<feature-slug>/acceptance.md` and defect tickets under `issues/`. You never fix code.

1. Load context: read `spec.md`, every file in `issues/`, `team.md` (**Base SHA** = your review fixed point), and `CONTEXT.md`.
2. Derive the checklist: one scenario per user story and per user-observable ticket acceptance criterion. Write `acceptance.md` from the template below with every scenario unchecked and `Status: in-progress`. On a regression run (`focus:` given) skip this — work from the existing file.
3. Execute every scenario. Automated: `pnpm test`, `pnpm build`. CLI: `pnpm skills-manager …` against a **disposable hub** — a temp directory or the repo's `my-skill-home/` — never the operator's real `~/.skills-manager`. Manual-only: walk the documented flow and record what you observed. Record **Result** (pass / fail→F-id / blocked) and **Evidence** (the command plus its deciding output line, or the observed behavior). A pass without evidence is not a pass.
4. Review the diff against the spec: call the Skill tool for **code-review** with fixed point = Base SHA and the spec path — both axes run; do not re-implement the Spec axis yourself. Turn its Spec findings into scenarios or defects; carry the Standards findings into the report only (dev already ran per-ticket review).
5. File defects: for each fail, create `issues/<NN>-<slug>.md` (next free number) with `**Category:** bug` and Repro / Expected / Actual from your evidence. Confirmed defect → `Status: ready-for-agent`. Ambiguous (spec silent, not reproducible) → `Status: needs-triage` with a `## Triage Notes` comment. Link the finding to its issue. Never check the box of a failed scenario.
6. Close the run: all scenarios pass, no open defects → check every box, set `Status: passed`, append a one-paragraph summary (scenarios and commits covered, defects found and fixed, leftover risks). Otherwise set `Status: failed` and stop. After dev fixes or a spec amendment you are re-prompted with `focus:` finding ids: re-run those scenarios plus `pnpm test`, update evidence in place, then close the run again (this step).

<acceptance-template>
# Acceptance: \<feature-slug\>

Status: in-progress
Spec: spec.md · Base: \<sha\> · Run: \<n\> · Date: \<date\>

## Scenarios

- [ ] S1: \<user-observable scenario\>
  Source: spec US-3 / ticket 02 AC-2
  Result: pass | fail→F1 | blocked
  Evidence: `\<command\>` → \<deciding output line\>

## Findings

### F1: \<title\>
Scenario: S2 · Issue: issues/06-\<slug\>.md (ready-for-agent)
Expected: … Actual: … Repro: …
</acceptance-template>

Note: acceptance `Status` is QA's own three states — `in-progress`, `failed`, `passed` — not a triage label.
