# Changelog

## 2026-08-26 (copy-mode auto-refresh)

- **Copy 模式自动刷新**（ADR-0008）：hub 技能内容变化后，`copy` 目标按 fingerprint 判定为过期并被整树刷新；symlink 目标直连技能库实时内容，永不判定过期（`entryOutdated` 对 symlink 短路）。刷新是原子算子 `refreshStaleEntry`：单条失败记录在索引条目 `error: { code, message, at }` 上，不阻断兄弟目标，下次成功即清除。
- **add / update 级联刷新**：技能库写入成功后自动刷新所涉技能的全部过期副本目标（`redistributeOutdatedForSkill`，带 delta-guard 不写无变化的记录）。
- **CLI**：新增 `skills-manager status`（`outdated: N, errored: M`、刷新错误明细、修复命令提示）；`redistribute --refresh` 作为 `--outdated` 的别名（输出 `Refreshed N, errored M.`）；`add` / `update` 成功后仍有其他过期目标时末尾追加一行提醒。
- **Dashboard**：技能行新增 `staleCount`（`error` 与 fingerprint 过期都计入）与过期徽标 + 一键「刷新副本」按钮；新增 `POST /api/distribute/refresh`（按 skill 或全局）与 `GET /api/distributions/stale`（`staleSummary()`）。
- 词汇表新增 **Stale** / **Stale target**（见 CONTEXT.md 与 ADR-0008）。

## 2026-08-26

- **smoke scripts retired into vitest**: all six `scripts/smoke-*.mjs` and their package.json entries are deleted. The two layers vitest could not see — the compiled bin and the packed artifact — moved into `tests/cli/cli-bin.test.ts` (spawns `dist/cli.js`: home resolution, help, migrate-views) and `tests/package/package-smoke.test.ts` (pack → install tarball → bin doctor → dashboard API). The four service/api smokes were redundant with the vitest suites (same fakeGit/inject patterns, dist vs src only). Also this day: legacy prototype shell scripts (`doctor.sh`, `install-from-git.sh`, `update-from-git.sh`, `adopt-installed.sh`, `rebuild-collections.sh`, `rebuild-views.sh`) deleted — superseded by the CLI; dev tooling unified on pnpm (npm/pnpm pack JSON shape difference normalized in one helper).
- **No in-repo metadata for project distribution** (ADR-0007): the in-project `.skills-manager/` directory (receipt + backups) is deleted outright — project distribute records only in the hub index (`.skills/distributions.jsonl`). Project applies take no snapshots; `distribute rollback` on a project target errors (`git is the restore point`), user rollback keeps its hub-side stash. `doctor --project` and migrate-consumers' receipt leg are removed. Collaboration model: copy + git is the sync channel; teammates are pure consumers. Existing projects may `rm -rf <project>/.skills-manager` by hand.
- **CLI command `dashboard` renamed to `web`**: `skills-manager web` starts the local dashboard (flags unchanged: `--port`, `--host`, `--no-open`); the old `dashboard` name remains as a hidden deprecated alias, same policy as `distribute-rollback`. README, CLI.md, GETTING_STARTED.md, and CONTEXT.md now reference `web`.
- **`.scratch/` no longer tracked by git**: added to `.gitignore` and removed from the index; specs/issues stay as local working notes. History before this change still contains the directory.
- **Date-based versions with tag-triggered npm publish**: `package.json` moves from semver to calendar versions (`2026.8.26` — npm semver rejects leading zeros, hence no `08`); the CLI reads `--version` from `package.json` instead of a hardcoded string. `pnpm run release` (scripts/release.mjs) checks a clean synced main, stamps today's date (same-day reruns get `-2`, `-3`, …), commits, tags `v<version>`, and pushes; the pushed tag runs `.github/workflows/publish.yml` (pnpm build + full test suite + `npm publish`).

## 2026-08-25

- Dashboard collapsed to a **single-page skill library** (ADR-0005): every hub skill is one typographic row (name · plain-text status · grey description, hover-faded actions); search, source-first ＋添加 wizard, and a 日志 drawer replace the five former surfaces. All legacy hashes land on the one page.
- Any-agent 接入 picker per ADR-0004 (已检测/全部目录, family select-all, per-scope memory = last confirmed apply), standalone 撤除接入, and a one-step 从库中移除 (undistribute everywhere + archive behind a consequence-stating confirm).
- Update affordances are in-place only: row 更新 on `hasUpdate` rows and one top line「N 个技能可更新 · 全部更新」; `hasUpdate`/`updateCount` now derive from a real source diff (local tree hash / remote head vs upstream commit), not update-plan membership.
- Batch is one pattern: hover-revealed checkboxes enter a selection mode with a floating bar (更新 / 接入 / 移除 · 取消, Esc exits).
- Dashboard HTTP API trimmed in place: `GET /api/state` slimmed to `skills[]` (incl. `distributedAgents` from the hub distribution index logical layer) + `activity[]` + `updateCount`; dead endpoints (registry, sources, activity, doctor, package, redistribute, rollback, migrate-views, …) deleted; `POST /api/skills/remove` added. Core services and CLI unchanged; `dashboard-web` rewritten from scratch with no component library (naive-ui dropped).

## 2026-08-06

- Initial non-destructive import from `~/.agents/skills` and `~/.claude/skills`.
- Added canonical `skills/`, consumer `views/`, `collections/`, registry, and management scripts.
