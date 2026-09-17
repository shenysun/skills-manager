# Changelog

## 2026-09-18 (dangling remote HEAD pull fix)

- **修复自建远端 HEAD symref 悬空时新机 pull 兜底失败（ticket 08）**：`git init --bare`（不带 `-b main`）的远端 HEAD symref 默认指向从未被推送的分支，hub 推送的固定分支是 `main`——远端明明有内容，新机 pull 却报「远端还什么都没推过」且按指引永远无法自愈。修复：merge 目标改为四段解析链——本机 upstream → 同名远端分支（pull 合并的正是 `push -u origin HEAD` 推送的目标）→ 远端声明的 HEAD 分支 → 唯一远端分支（前三步均不中且远端多分支时非零退出，如实列出远端实际分支与本机分支并给出 `--set-upstream-to` 指引，绝不瞎猜）；分支枚举改读 fetch 后的 `refs/remotes/origin/`（本地读，无第二次网络往返，且正是 `origin/<name>` 合法目标的权威集合），fetch 升级为 `--prune`——远端已删分支不得以幽灵 tracking ref 残留成候选；「nothing has been pushed yet」措辞只在远端真的没有分支时出现（新错误码 `sync_remote_empty`，不可判定时错误码 `sync_merge_target_ambiguous` 如实列出远端分支与本机分支）。CLI 双语参考与 CONTEXT Hub sync 词条补 merge 目标解析链。
- 测试：CLI seam 新增七条——QA 原始复现（悬空 HEAD 远端新机首拉成功合入）、多分支远端同名优先（merge subject 锁定 `origin/main`）、远端声明 HEAD 兜底（adopt 仓库本地分支不在远端）、不可判定时如实拒绝（列分支、不谎称 nothing pushed、带指引）、真空远端保留准确 nothing-pushed 措辞、同名优先排序意图显式锁定（adopt dev 机合 `origin/dev` 而非远端声明的 main——pull 合并的正是 push 推送的目标）、远端删分支后 prune 不留幽灵目标（回退到远端声明 HEAD）；fixture `makeBareRemote` 支持显式 headBranch 以覆盖自建默认世界。

## 2026-09-18 (new-machine first-pull registry fix)

- **修复新机首拉必冲突（ticket 07）**：真实 hub（装过至少一个 skill）在新机 `sync init --remote` 后首次 `sync pull`，B 机基线里的占位 `registry.yaml`（`skills: {}`，init 时 ensure() 生成）与 A 机真实 registry 在 unrelated-histories merge 下必然 AA 相撞、退出 1——「不需要理解 git 也能同步」的最普通首次设置路径被打断。修复：三条前置同时成立时 pull 自动以远端真实 registry 覆盖占位并结成 merge commit——① `registry.yaml` 是唯一冲突路径；② 本地内容为字节级占位符；③ 本地历史仅有那一条 init 基线提交（`sync: baseline commit`）——该状态下本地不存在任何用户数据（未 push、无手工提交），故不构成「对用户数据做合并决策」；移除最后一个 skill 后序列化回 `skills: {}` 的真实清空 push 因历史不止基线一条而被排除。其余一切冲突形状（其他路径参与、本地 registry 真实、历史超出基线）仍原样留给 `git -C <hub>` 手工解决。CLI 输出零省略注明占位被真实侧取代（`registry conflict: resolved by keeping the remote registry …`）。CLI 双语参考与 manager skill 同步章节补唯一例外措辞；占位符常量 `EMPTY_REGISTRY_FILE` 与基线提交信息 `BASELINE_COMMIT_MESSAGE` 单点定义。
- 测试：CLI seam 新增五条——QA 原始复现（A 机真实 registry + B 机空 hub 首拉干净合入）、双侧真实 registry 冲突仍手工（AA 原样）、共享历史上字节级空 registry（真实清空 push）绝不自动解决（UU 原样）、本地真实 registry 对远端占位同样留给手工（远端空可能是真实清空）、真实文件与占位 registry 并发冲突整体拒绝不半自动解决；另以真实 `add` 安装路径端到端复现验证（fixture 手写 registry 正是此前盲区）。

## 2026-09-18 (hub git sync + skills.sh find)

- **Hub git 化多机同步 MVP**（ADR-0020）：hub 本身成为 git 仓库，对用户自选远端 push/pull 即同步——不做 skill 级合并（git 已是合并工具）、不做设备码/token 代管（凭据留在用户自己的 git 里）。`skills/`、`collections/`、`registry.yaml` 进版本控制；`.backups/` 与 `.skills/`（分布索引、回滚快照、活动日志）为机器本地状态，canonical `.gitignore` 排除——分发是每机自己的事，新机 pull 后自行 distribute。
- **`sync init [--remote <url>]`**：git init 或 **adopt** 既有 `.git/`（领先一步不是错误，历史保留）；`.gitignore` 只追加缺失行不改写用户条目；树上有未提交内容时做一次基线提交；`--remote` 挂 origin（已有不同 origin 拒绝改指）。幂等，输出零省略补齐清单 + 敏感信息推送提醒。bootstrap 保持不 git 化（ADR-0014 不变）。
- **`sync push`**：add -A + 技能级汇总 commit（新增/更新/移除 skill 数 + registry 旗标；同 skill 内 rename 归并为 update、跨 skill rename 记一加一移）+ push。无变更且远端一致输出「已是同步状态」退出 0，绝不造空提交。硬闸全带指引非零退出：未 git 化 / 无 remote / 无 git 身份（绝不代配）/ 未出生 HEAD。
- **`sync pull`**：干净工作树前置（脏树拒绝绝不 stash，指引先 push）；fetch + merge（允许 merge commit，不用 ff-only/rebase）；冲突透传 git 非零退出 + `git -C <hub>` 手工解决指引——绝不内置合并决策。新机首拉经 `--allow-unrelated-histories` 接纳基线根历史，merge 目标 `@{upstream}` 优先、远端 HEAD 分支兜底。结尾技能级拉取统计（与 push 同一计数规则）+ distribute 纯文案提示不自动执行。
- **`sync status [--json]`**：只读零网络——git 化 / remote / 脏文件数 / ahead-behind（基于 remote-tracking ref，注明「上次 fetch」口径）/ 最近同步 commit；未 git 化友好提示退出 0（push/pull 则非零）。
- **manager skill「查找与发现技能」工作流 + skills.sh 直连主通道**（ADR-0021）：「帮我找个 X skill」成为一等公民流程（需求 → 英文关键词提炼 → 三通道表搜索 → verify-before-presenting → 带据呈现 → 用户确认 → 既有 source-first install，装后 distribute 保持显式步骤）。共享三通道表一处定义两处引用（provenance backfill Step 3 改引用不重定义）：① `curl skills.sh/api/search`（主，结构化 JSON 含 installs）② `npx skills find`（二）③ `gh api search/code`（三兜底）；四条件降级矩阵（超时/非 200/解析失败/skills 空或缺）无声降级、结果注明通道；installs 标注为安装量信号非质量担保。CLI 不加 `find` 命令（ADR-0012 非目标维持）。
- **manager skill「多机同步」章节**：三段式工作流（首次 `sync init --remote` → 变更后 push → 新机 pull 后自行 distribute）+ 纪律陈述与 CLI 硬闸逐字对齐（pull 不自动分发、冲突指引 `git -C <hub>`、脏树先处理、git 身份/remote/未 git 化绝不代决策）。
- **落档**：ADR-0012 两条修订标注（网络措辞「git 传输（clone/fetch/push/pull）+ catalog refresh」、双通道 → 有序三通道，循 ADR-0006 先例）；ADR-0020 基线提交措辞对齐实现；CONTEXT 词条 **Hub sync** / **Find channels**；ROADMAP #6/#7 移入已完成；CLI 双语参考；升级分发走 ADR-0014 自刷新机制。
- 测试：CLI seam 全场景 bare-repo 远端覆盖（init 全新/adopt/幂等、push 正常/空变更/无 remote/无身份、pull 正常/脏树/冲突、status 各维度 + `--json`、多机往返 tracer）+ manager-skill 服务三条薄断言（通道序 / 单一定义 / installs≠质量担保）。

## 2026-09-17 (named presets)

- **命名预设（preset / 档位）**（ADR-0019）：把一份领域类别清单存成可反复 apply 的命名**档位**——`registry.yaml` 顶层新增 `presets:` map（对象形状，随 hub 走），独立 `preset` 命令组四子命令。supersede ADR-0015 _Avoid_ 中「named switchable profiles」条款；裸 `categories apply` 语义原封不动（回归锁）。
- **`preset set / list / remove`**：`set <name> <cat...>` 覆盖式建档（safe-preset-name 校验；类别可先于词汇表存在——先建档位、后打标）；`list` 显示成员类别 + 挂载足迹（承载该档位的物理运行时路径，为零省略，漂移按实报告）；`remove` 删条目并级联清空所有引用该名的档位戳（categories 原样、runtime 不动），输出摘除路径数。
- **`preset apply <name>`**：apply 时实时解析类别，复用 ADR-0015 路径级严格改写（`-a` 可重复 / 缺省检测集、共享路径写一次、manager skill 豁免、foreign 不动、uncategorized 移除、幂等可重跑恢复）并盖档位戳——`categories status` 并列显示档位名；裸 `categories apply` 清戳（手动覆盖不误报）、`--all` 随解散清除、`distribute rollback --to user` 连带恢复。成功尾部一行该档位常驻成本（`≈` char-approx，复用 ADR-0018 核心；`--json` 给结构化 `cost` 字段）。
- **两道硬错闸**：预设解析为 0 个受管技能、引用类别不在词汇表——均在 apply 时点名预设与类别拒绝执行，命名对象永不静默清档。
- **文档收口**：manager skill 档位话术映射（「换个档位 / 只留前端技能 / 切到 X 组合」→ `preset apply`，「记住这个组合」→ `preset set`）+ 提议 apply 必陈述严格语义与成本行；CLI 双语参考、ROADMAP #5、CHANGELOG 同步。
- 测试：preset set/list/remove/apply 全链路 CLI 端到端（含覆盖语义、safe-name 拒绝、两硬错闸文案、档位戳写入/清除/级联/rollback 随行、status 并列显示、幂等、共享路径写一次、成本尾行与 `--json`）。

## 2026-09-17 (resident-cost ledger)

- **常驻成本账本**（ADR-0018）：只读核心按**物理 runtime 路径**分组统计每个受管分发的常驻 token 成本——口径为 frontmatter `name + description`（char-approx：CJK ×1、其余 ÷4，零依赖），共享路径只计一次并标注 agent family，user 与 project 路径同账，foreign 条目只报不计数的行。hub「未分发 = 零常驻」模型第一次有了承载面。
- **`skills-manager cost`**：人读输出（路径组 → per-skill 行 → 总计 + unmanaged 行 → 三层建议）与 `--json` 三层结构（`paths[]` / per-skill / `suggestions`）同源同构；`--top <n>`（默认 5）控制最贵 description 清单长度；顶层 `method: "char-approx"` 元数据声明近似口径，展示一律 `≈1.2k` 风格缩写。
- **建议只报告不执行**：每条建议附逐字可运行的 `undistribute` 命令（含必需的 `--to`，project 路径带 `--project`）；三层为 archived-but-distributed 零争议收回（置顶）、top-N 最贵 description、scattered 归并提示。无 token 阈值、无使用判断、无 `--apply`。
- **缺陷诚实**：SKILL.md 不可读（含 broken symlink，与 doctor 共享判定谓词）计 0 并进 errors 节；description 缺失按 name-only 计并标 `incomplete`。
- **doctor `residentCost` 集成**：报告常驻结构化字段（账本核心直挂，恒存在）；告警仅在跨路径 scattered 重复分发时提及常驻成本——doctor 报病、账本报账。
- **dashboard 常驻成本线**：内容区顶部「常驻 ≈N tokens · N 路径」一行（与 update strip 同区域同样式），inline 展开为 per-path 分组明细；skill preview 接入展开区行尾 `· ≈N` 足迹。懒加载自新端点 `GET /api/cost`，`/api/state` 形状零变化；zh/en 双目录收录。
- **manager skill 收录 cost 工作流**：查账本（`--json` 三层 + `method` 语义——agent 不得把 `≈` 近似数当精确数转述）→ 未经提示即建议收回昂贵/零争议分发，建议只指向 `undistribute`（`get` 与 `archive` 是可叙述不代执行的用户侧后续）。
- 测试 +43 例：char-approx 纯函数、账本服务（共享路径/user+project/foreign/archived/scattered/缺陷标注）、CLI 渲染与 `--json`/`--top`、doctor residentCost 与仅 scattered 告警、`/api/cost` 端点、dashboard domain 纯函数与两端点 join 用例。

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
