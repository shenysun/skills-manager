# Changelog

## 2026-08-26

- **smoke scripts retired into vitest**: all six `scripts/smoke-*.mjs` and their package.json entries are deleted. The two layers vitest could not see — the compiled bin and the packed artifact — moved into `tests/cli/cli-bin.test.ts` (spawns `dist/cli.js`: home resolution, help, migrate-views) and `tests/package/package-smoke.test.ts` (pack → install tarball → bin doctor → dashboard API). The four service/api smokes were redundant with the vitest suites (same fakeGit/inject patterns, dist vs src only). Also this day: legacy prototype shell scripts (`doctor.sh`, `install-from-git.sh`, `update-from-git.sh`, `adopt-installed.sh`, `rebuild-collections.sh`, `rebuild-views.sh`) deleted — superseded by the CLI; dev tooling unified on pnpm (npm/pnpm pack JSON shape difference normalized in one helper).
- **No in-repo metadata for project distribution** (ADR-0007): the in-project `.skills-manager/` directory (receipt + backups) is deleted outright — project distribute records only in the hub index (`.skills/distributions.jsonl`). Project applies take no snapshots; `distribute rollback` on a project target errors (`git is the restore point`), user rollback keeps its hub-side stash. `doctor --project` and migrate-consumers' receipt leg are removed. Collaboration model: copy + git is the sync channel; teammates are pure consumers. Existing projects may `rm -rf <project>/.skills-manager` by hand.

## 2026-08-25

- Dashboard collapsed to a **single-page skill library** (ADR-0005): every hub skill is one typographic row (name · plain-text status · grey description, hover-faded actions); search, source-first ＋添加 wizard, and a 日志 drawer replace the five former surfaces. All legacy hashes land on the one page.
- Any-agent 接入 picker per ADR-0004 (已检测/全部目录, family select-all, per-scope memory = last confirmed apply), standalone 撤除接入, and a one-step 从库中移除 (undistribute everywhere + archive behind a consequence-stating confirm).
- Update affordances are in-place only: row 更新 on `hasUpdate` rows and one top line「N 个技能可更新 · 全部更新」; `hasUpdate`/`updateCount` now derive from a real source diff (local tree hash / remote head vs upstream commit), not update-plan membership.
- Batch is one pattern: hover-revealed checkboxes enter a selection mode with a floating bar (更新 / 接入 / 移除 · 取消, Esc exits).
- Dashboard HTTP API trimmed in place: `GET /api/state` slimmed to `skills[]` (incl. `distributedAgents` from the hub distribution index logical layer) + `activity[]` + `updateCount`; dead endpoints (registry, sources, activity, doctor, package, redistribute, rollback, migrate-views, …) deleted; `POST /api/skills/remove` added. Core services and CLI unchanged; `dashboard-web` rewritten from scratch with no component library (naive-ui dropped).

## 2026-08-06

- Initial non-destructive import from `~/.agents/skills` and `~/.claude/skills`.
- Added canonical `skills/`, consumer `views/`, `collections/`, registry, and management scripts.
