# Resident-cost ledger: char-approx counting, read-only `cost` command, report-only downgrade

Competitor research (asm's attention budget, the only tool in the field framing skill management as context-budget management) surfaced that our hub model's best selling point — undistributed = zero resident — was never shown to the user as an account. We decided to build a resident-cost ledger on the existing distribution index rather than a usage-based advisor: what agents pay per message is knowable (frontmatter `name + description`), what they actually use is not.

Token counting is **char-approx** (CJK characters ×1, all others /4, `≈`-prefixed, `method: "char-approx"`), deliberately not a tokenizer dependency: agents run different tokenizers, so exactness is pseudo-precision and the number's real job is magnitude reference. The ledger is a new read-only command `skills-manager cost` — named `cost`, not `stats`, to anchor single responsibility — grouped by physical runtime path (user and project both, shared paths once, managed entries only with foreign shown as an uncounted-count line), sourced index-first but counted from the runtime SKILL.md actually present (broken entries count 0 and surface as errors; missing description counts name-only with `incomplete: true`).

Downgrade suggestions are **report-only**: each carries a verbatim `undistribute` command (including the required `--to`) and nothing is ever auto-executed; there is no `--apply`. We make no usage claims — no "unused" detection, no token thresholds — and no body-cost column (irrelevant to the recall decision). archived-but-distributed skills count and head the suggestions as zero-controversy recalls. Doctor gains only a structured `residentCost` field (plus a warning solely on scattered duplicates): doctor reports illnesses, the ledger reports accounts. The dashboard shows the account as a top inline line (typographic-flow expansion, no new sheet) plus per-target tokens in the skill preview's distribution expansion, both fed by a new lazy `GET /api/cost`.

## Consequences

- The `≈` numbers will disagree with any single agent's own token counter; that is accepted and stated, not hidden.
- Foreign entries in runtime directories stay out of the per-skill detail (v1) — the account is honest about what it omits but does not claim authority over paths it does not manage.
- If usage signals ever become available (agent-side reporting), the suggestion layer can grow on top of the ledger without changing its counting core.
