# Orchestration reference

Exact commands, prompts, and file formats for `/team` orchestrator mode. Parse every ID from the JSON response (`.result.…`); never guess one. All commands assume HERDR_ENV=1 in the repo root.

## Up

1. Discover state: `herdr tab list --workspace "$HERDR_WORKSPACE_ID"` and `herdr agent list`. Abort if any team name is live but not recorded in our team.md.
2. Run `herdr tab --help` first; then create the team tab pinned to the calling session's workspace — omitting `--workspace` lets the server pick its own default, which may be a different workspace than the user is looking at:
   ```bash
   herdr tab create --workspace "$HERDR_WORKSPACE_ID" --label team-<slug> --cwd "$PWD" --no-focus
   ```
   Parse `.result.tab` → TAB and `.result.root_pane` → P_PM. Verify the returned tab's workspace matches `$HERDR_WORKSPACE_ID`; if not, close it and retry with the explicit flag.
3. If the root pane's shell is not in "$PWD": `herdr pane run "$P_PM" "cd \"$PWD\""` and wait for the prompt to return.
4. Split the remaining panes — pm and po stack in the left column (the interview and its answers read as one dialogue), dev and qa stack on the right. Never three columns:
   ```bash
   herdr pane split "$P_PM"  --direction right --cwd "$PWD" --no-focus   # → P_DEV
   herdr pane split "$P_DEV" --direction down  --cwd "$PWD" --no-focus   # → P_QA
   herdr pane split "$P_PM"  --direction down  --cwd "$PWD" --no-focus   # → P_PO
   ```
5. Start one agent per pane; success means ready. On `agent_not_ready`: read the pane, tell the user, offer focus — do not retry blindly. On `agent_pane_busy` the split pane's shell has not reached its prompt yet: wait a few seconds and retry once:
   ```bash
   herdr agent start pm  --kind claude --pane "$P_PM"  -- --permission-mode bypassPermissions
   herdr agent start po  --kind claude --pane "$P_PO"  -- --permission-mode bypassPermissions
   herdr agent start dev --kind claude --pane "$P_DEV" -- --permission-mode bypassPermissions
   herdr agent start qa  --kind claude --pane "$P_QA"  -- --permission-mode bypassPermissions
   ```
6. Write `.scratch/<slug>/team.md` (format below) with TAB, the pane IDs, agent names, and `git rev-parse HEAD` as Base SHA.
7. Send the PM kickoff (§Prompts) with `--wait --timeout 120000`.

## Prompts

Send with `herdr agent prompt <name> "<text>"`. Use `--wait --timeout` for short pm/po/qa turns; send dev turns plain (no `--wait`) — a ticket runs for many minutes and `go` re-derives state from files anyway.

**Reserved slash commands** — `/to-spec`, `/to-tickets`, `/implement`, `/triage` — are user-invoked only, so roles cannot call them via the Skill tool. The orchestrator relays them into the pane (the user's `/team` invocation is the explicit authorization).

- pm kickoff: `/team role: pm feature: <slug>。用户想法：<one-line idea>。问题将由 PO 在 po pane 代答，编排器会把答案转发给你。`
- po answer: `/team role: po feature: <slug>。<questions pending before PO, each with its recommendation>`
- pm to-spec: `/to-spec` — only after pm announces `ready for /to-spec` (`--wait --timeout 180000`)
- pm ruling: `/team role: pm feature: <slug> ruling: <issue path>` — with the PO's decision quoted in full
- dev tickets: `/to-tickets .scratch/<slug>/spec.md` — relay; when dev asks for breakdown approval, route the questions through po like any interview round
- dev ticket: `/clear` (no `--wait`), then `/team role: dev feature: <slug> ticket: <NN>`
- qa kickoff: `/team role: qa feature: <slug>`
- qa regression: `/team role: qa feature: <slug> focus: <F1,F3>`

## team.md

<team-md-template>
# Team: \<feature-slug\>

- Tab: \<w1:tN\>
- Panes: pm=\<w1:pN\> po=\<w1:pN\> dev=\<w1:pN\> qa=\<w1:pN\>
- Agents: pm, po, dev, qa
- Base SHA: \<sha\>        # QA review fixed point
- Feature dir: .scratch/\<slug\>/
- Started: \<ISO date\>
</team-md-template>

## Answering

The pm-interview loop, run by the orchestrator. Repeat until pm announces `ready for /to-spec`:

1. `herdr agent read pm --source recent-unwrapped --lines 60` and extract the pending questions.
2. Prompt po with the questions quoted in full (`--wait --timeout 120000`).
3. If po answers `ESCALATE`, take that question to the user here and merge their decision in.
4. Relay po's numbered answers verbatim to pm (`--wait --timeout 120000`). Po's answer text is the decision — do not edit it.

## Recovery

- **Dead agent** (pane closed, name gone from `herdr agent list`): split a replacement pane with the same geometry, `agent start` the same name, re-send the current stage's prompt — the files carry all state.
- **Stale in-progress ticket with idle dev**: read the pane tail. If the turn ended without the Status flip, prompt dev to finish the ticket; if the work is lost, set the ticket back to ready-for-agent and re-prompt.
- **Wait timeout / agent_prompt_stalled**: not a failure, and the prompt was not necessarily lost. Read the pane, report, let the user decide. Do not blindly re-submit.
