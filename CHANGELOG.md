# Changelog

## 2026-09-10 (manager-skill-first)

- **manager skill 成为产品正门**（ADR-0014）：`npx skills-manager-cli` 不带子命令即 bootstrap——建 hub → 从 npm 包内副本种 manager skill（以发布 tag `v<version>` 作为 source 戳，tree-SHA 更新检测照常可用）→ 挂载（symlink）到你选择的 agent → 打印起始提示词（「帮我看看我的 skills：有哪些、装到哪些 agent 了、有没有能更新的」）。幂等；**永不导入**——导入存量 runtime skills 是装完后通过 manager skill 在对话里完成的动作，bootstrap 只提示发现数量。
- **挂载选择**：TTY 下对检测到的 agent 弹多选（默认全勾，↑↓/space/a/enter；`--agent` 跳过提问），非 TTY 挂到全部检测到的 agent；一个都没检测到时照样建 hub + 种 skill 并提示之后怎么挂。CLI 的唯一交互时刻，其余命令保持纯 flag 非交互。
- **`ManagerSkillService` 自检刷新**：registry 条目新增种子指纹 `source.baseline_hash`——CLI 每次运行对比包内副本与 hub 副本，仍然归我们管（baseline 匹配）且不是降级（`compareDateVersions` 按段比较日期版本）时静默刷新；用户改过或从别处装的副本视为外来物，不碰。刷新提示走 stderr，stdout 保持纯 JSON 可解析。
- **单一 hub 入口**：隐式建 hub 收敛为 bootstrap 独有——`web` 及其他命令在默认 hub（`~/.skills-manager`）缺失时报友好错误并指引 bootstrap，不再静默创建；显式 `--home` / `SKILL_HOME` 仍是操作者声明，照旧确保。
- **防吞拼错的子命令**：注册 no-arg action 后 commander 会把未知子命令当参数传进来，已显式报 `unknown command` 而不是静默跑 bootstrap。
- **SKILL.md 增加 First-run / 空库引导节**：第一次对话先看状态、只提一个动作、等确认；并修正「CLI 非交互」表述（bootstrap 多选是唯一例外）。
- **文档 skill-first 重写**（README / GETTING_STARTED / CLI，双语）：hero 一条 npx 命令 + 提示词；工作原理图（agent ⇄ manager skill ⇄ hub ⇄ runtime）；web 降级为可选段（不再建 hub）；删除 GitHub `add` 两步装 manager skill 的指引；`npm i -g` 缩为尾注。
- 测试 +18：服务级（种子/幂等/刷新/外来物保护/防降级/版本比较/缺副本报错）与 CLI 级（bootstrap 全链路、幂等重跑、检测挂载 symlink、报告而不导入、no-arg 默认 hub、单入口守卫 list+web、`--force` 替换外来 runtime 副本）。

## 2026-09-09 (init 批量化 + CLI 懒加载)

- **init 导入消除 O(N²)**（用户反馈「初始化特别慢」修复）：诊断确认非 Node.js 性能（CPU profile：V8/GC 仅 ~1.4%），根因是 init 对每个 skill 单独调一次 `distribute.apply`——每次 restore-point 快照为当时已导入的全部 entry 重建 symlink（实测 400 位置导入 15.8s，hub 残留 150 个快照目录、11,175 个 symlink 且永久累积）；同时每 skill 全量读写 registry.yaml 与 distributions.jsonl，字节量随 N 平方增长。
- **`DistributeService.applyMany`**：批内一次 restore point、一次 index 读、一次 index 写；per-request 校验与失败隔离（一个坏请求不炸整批）。`apply` 变单请求包装，签名与抛错契约不变，全部现有调用方零改动。restore point 保留最新 5 个（原无限累积）。
- **`RegistryService.ensureEntries` + `InitService` 两阶段**：N 条目共享一次 registry load/save；init 拆为「内容搬移（per-skill 隔离）→ 一次批量提交」，失败语义不变（`failed` 数组、`choices` 剔除）。批量导入只产生一个「init 前状态」restore point，rollback 语义更完整。
- **CLI 懒加载 dashboard 依赖**：`web` 命令 action 内动态 import fastify/shiki/markdown-it，其余命令零加载。
- **效果**：init apply（4 目录 × 100 skills）15.84s → 0.64s（24.7×，边际 ~1.5ms/位置，线性）；`--version` 0.63s → 0.07s、`list` 0.39s → 0.05s（每条命令免 ~0.6s 依赖加载税）；web bundle 456KB → 387KB。运行时实测 bun 与 node 打平——剩余成本为 fs syscall 与依赖加载，换运行时无收益。

## 2026-09-09 (tree-SHA update pipeline)

- **更新锚点改用 skill 子目录 tree SHA**（ADR-0013）：registry 条目 `source` 新增 `upstream_tree`，`upstream_commit` 保留作溯源记录。「可更新」只在 skill 内容真变时成立——上游改 README、改别的 skill 不再点亮更新按钮；GitHub Trees API 与本地浅克隆对同一子目录解析出相同 tree SHA，两侧锚点天然对齐。
- **git 传输统一浅克隆**：安装/更新对 git 源一律 `--depth 1`（branch/tag 经 `--branch`，裸 commit SHA 走 init + `fetch --depth 1`），不再拉完整历史，大仓库（awesome-copilot 类）在不稳网络下的传输量与被掐断概率骤降。
- **clone 网络类失败自动以 HTTP/1.1 重试一次**：`curl 92`（HTTP/2 stream 未闭合）/ `curl 56`（connection reset）类失败通过进程内 `GIT_CONFIG_COUNT` 环境变量注入重试，不改用户全局 git 配置。
- **GitHub 源更新检测走 Trees API**（dashboard `/api/state`）：按源归并（同 repo 同 ref 一次调用）、gh CLI 登录态优先（5000 req/h）、无 gh 匿名兜底（60 req/h）、内存 TTL 缓存——刷新页面命中缓存 10ms 级返回，不再逐 skill ls-remote 15 秒转圈。
- **检测即校准**：存量条目首次被 API 检测覆盖时自动补齐 `upstream_tree`（幂等低频写回），无需迁移命令；校准本身不点亮更新。
- **检测失败显式可见**：skill 行新增 `detection` 状态（`ok` / `failed` / `skipped`），失败行显示「检测失败」角标（区别于「无更新」），每次失败向 `<home>/.skills/dashboard.log` 追加一条带时间戳与原因的 JSON 行；单源失败不阻塞其余行与接口数据。

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
