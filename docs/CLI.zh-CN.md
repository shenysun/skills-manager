# Skills Manager CLI

[English](CLI.md) | **简体中文**

`skills-manager-cli` 提供 `skills-manager` 可执行命令，管理本地优先的技能库。

## 技能库解析

优先级：

1. `--home <path>`
2. `SKILL_HOME`
3. 当前目录（当它已经是一个技能库时）
4. `~/.skills-manager`（仅由 bootstrap 创建，ADR-0014 —— 其他命令发现技能库缺失时会提示你先跑 bootstrap，不再隐式创建）

初始化会创建 `skills/`、`collections/`、`registry.yaml`，以及 `.skills/` 数据目录。

## bootstrap（正门）

```sh
npx skills-manager-cli                 # 不带子命令 = bootstrap
skills-manager bootstrap --agent claude-code --agent cursor   # 脚本化
skills-manager bootstrap --force       # 替换运行时路径上非托管的 skills-manager
```

bootstrap（ADR-0014）只做四件事：确保技能库存在；从 npm 包内副本把 **manager skill** 种进库（以发布 tag 作为更新来源戳）；把它（软链接）挂载到你选择的 agent —— TTY 下对检测到的 agent 弹多选（默认全选），`--agent` 跳过提问，非 TTY 挂到全部检测到的 agent；最后打印起始提示词。起始提示词之后还会打印两行可粘贴 CLI demo（`cost --share`、`doctor`），让常驻成本分享卡与健康/安全汇总一键可试——下次 npm 发版后尤其有用。它永远不做导入：导入现有运行时技能是你之后通过 manager skill 在对话里完成的动作。bootstrap 幂等；且 CLI 每次运行都会自检库内副本与包内副本，未被他改时静默刷新（你手改过的副本视为外来物，不再触碰）。

## 命令

```sh
skills-manager web --home ./my-skill-home
skills-manager doctor --home ./my-skill-home
skills-manager doctor --share
skills-manager catalog info --home ./my-skill-home
skills-manager catalog refresh --home ./my-skill-home
skills-manager list --home ./my-skill-home
skills-manager get my-skill
skills-manager get my-skill --path
skills-manager add <source> --all --yes
skills-manager update --plan
skills-manager update --check
skills-manager update --check --fail-on-stale
skills-manager update --skill my-skill
skills-manager update --source '<source-key>'
skills-manager distribute --to user --skill my-skill --agent claude-code --agent zed
skills-manager distribute --to project --project ./repo --skill my-skill --agent cursor --mode copy
skills-manager undistribute --to user --skill my-skill --agent claude-code
skills-manager redistribute --outdated
skills-manager redistribute --refresh --to project --project ./repo
skills-manager status
skills-manager cost --json
skills-manager cost --top 10
skills-manager audit security
skills-manager audit security my-skill
skills-manager audit security --strict
skills-manager audit security --strict --format github
skills-manager audit overlap [skills...] [--threshold <0-1>] [--strict] [--json]
skills-manager init --dry-run
skills-manager init --agent claude-code --agent cursor
skills-manager init --prefer claude-code ~/.agents/skills hub
skills-manager init --resolve my-skill=cursor --resolve other-skill=hub
skills-manager backup list
skills-manager backup restore my-skill
skills-manager edit my-skill --source-url https://github.com/owner/repo
skills-manager edit my-skill --source-git owner/repo --subpath skills/my-skill
skills-manager edit my-skill --source-git owner/repo --subpath skills/my-skill --source-ref v1.2.3
skills-manager provenance list
skills-manager provenance list --fail-on-imported
skills-manager check [--budget <tokens>] [--freshness] [--json]
skills-manager provenance adopt
skills-manager provenance adopt --dry-run --skill my-skill
skills-manager categories set my-skill 前端 后端
skills-manager categories add my-skill 金融
skills-manager categories remove my-skill 金融
skills-manager categories list
skills-manager categories apply 前端 金融 --agent claude-code
skills-manager categories apply --all
skills-manager categories status
skills-manager preset set frontend 前端 ui
skills-manager preset list
skills-manager preset remove frontend
skills-manager preset apply frontend --agent claude-code
skills-manager preset apply frontend --json
skills-manager sync init --remote <url>
skills-manager sync status [--json]
skills-manager sync status --share
skills-manager sync push
skills-manager sync pull
skills-manager archive old-skill
skills-manager rebuild-collections
```

distribute 的目标可以是任意目录中的 agent id（`--agent`，可重复）。省略 `--agent` 时作用于本机检测到的 agent 集合。用户范围默认 `--mode symlink`，项目范围默认 `--mode copy`；每次应用只能用一种模式。

### categories（领域类别与类别集，ADR-0015）

每个技能可携带自由多值的 `categories: []` 轴（前端 / 金融 / backend——用户自己的词表，不受控；规范化为 trim、去重、去空）。它与冻结的旧版标量 `category`（继续喂 `collections/` 与 `list --category`）正交。`categories set` 与 `edit --categories` 为覆盖式；`add` / `remove` 为增量式；`list` 输出全库标签及每标签计数。

`categories apply <cat...>` 是 distribute 层操作：把所选 agent（`--agent` 可重复，缺省 = 检测集）解析到物理运行时路径（去重），然后把每个路径改写为**恰好**持有类别与所应用集合相交的受管技能——缺的分发、集合外的受管条目撤除，**包括未打标的**。撤除是路径级严格语义（越集条目即使被未选中的同路径 family 成员引用也撤；集内条目折叠引用 agent 的并集）。manager skill 无条件豁免；foreign 条目永不触碰。apply 幂等且先打快照；`apply --all` 解散过滤（恢复全部受管技能、清除记录），与类别列表互斥。已应用集合按物理运行时路径持久化为分发索引的扩展；`distribute rollback --to user` 把运行时内容与类别集记录一起恢复。

apply 是显式快照——之后的打标或更新不会自动推送。`categories status` 报告各路径的已应用集合与漂移（「N 个技能现已匹配集合但未分发」）；重跑 `apply` 即收敛。见 [ADR-0015](adr/0015-domain-categories-category-set-loading.md)。

### preset（命名预设 / 档位，ADR-0019）

**预设（preset）**是一份命名的领域类别清单——可反复 apply 的加载集**档位**，不是安装组——存于 `registry.yaml` 顶层 `presets:` map。`preset set <name> <cat...>` 为覆盖式（同名原位覆盖；preset 名走 safe-name 校验；类别可先于词汇表存在——先建档位、后打标）。`preset list` 显示每个预设的成员类别与挂载足迹（当前承载它的物理运行时路径数，为零时省略；漂移按实报告，绝不暗示健康）。`preset remove` 删除条目并级联清空所有引用该名的 category-set 记录上的 `preset` 字段（categories 原样、runtime 不动），并输出摘除路径数。

`preset apply <name>` 在 apply 时实时解析预设类别，走 ADR-0015 原封不动的路径级严格改写——`--agent` 可重复（缺省 = 检测集）、共享物理路径只写一次、manager skill 豁免、foreign 不动、uncategorized 移除、仅 user scope——并在已应用的 category-set 记录上盖 `preset` 档位戳，`categories status` 将其与已应用集合并列显示。裸 `categories apply` 会清掉该字段（手动覆盖绝不误报为命名档位）；`apply --all` 随解散一并清除；`distribute rollback --to user` 把运行时内容与带戳记录一起恢复。两道硬错闸保护命名对象：解析为 0 个受管技能、引用类别不在词汇表，均在 apply 时点名预设与类别拒绝执行。成功输出尾部带该档位的常驻成本行（char-approx、`≈` 前缀；`--json` 给结构化 `cost` 字段）。见 [ADR-0019](adr/0019-named-presets-category-subsets.md)。

### sync（多机同步，ADR-0020）

```sh
skills-manager sync init --remote <url>   # git init（或 adopt）、canonical .gitignore、基线提交、挂 origin
skills-manager sync status [--json]       # 只读零网络的同步状态探测
skills-manager sync status --share        # 可粘贴分享卡（无 hub 路径 / remote URL）
skills-manager sync push                  # add -A + 一次技能级汇总提交 + push
skills-manager sync pull                  # fetch + merge（要求干净工作树）
```

hub 本身成为一个 git 仓库；对用户自选的任意远端（本地 bare repo 也可以）push/pull 即是同步的全部机制。`sync init` 幂等，且 **adopt** 既有 `.git/`（历史保留——用户领先一步不是错误），只追加缺失的 canonical `.gitignore` 行——`.backups/` 与 `.skills/` 是机器本地状态（回滚快照、分布索引、活动日志），永不同步，分发是每台机器自己的事——树上还有未提交内容时做一次基线提交，可选挂 origin。输出为零省略的「做了什么」清单，结尾提醒推送前确认 hub 无敏感信息。已有 origin 指向他处时拒绝改指并给出手工命令——绝不静默改。

`sync push` 暂存全部并做一次汇总提交（技能级计数：新增 / 更新 / 移除，registry 旗标；同 skill 内 rename 计为 update）后推送。干净树且远端已一致时输出「已是同步状态」并退出 0——绝不造空提交。`sync pull` 要求干净工作树（脏 → 非零退出，指引先 `sync push` 或手工处理；绝不 stash），随后 fetch + merge（允许 merge commit；不 rebase、不 ff-only）。merge 目标按优先级解析：本机 upstream（push 配置过时）→ 同名远端分支（pull 合并的正是 `push -u origin HEAD` 推送的目标——`sync init` 把每个新 hub 固定在 `main`，自建 bare 远端 HEAD symref 悬空也能解析）→ 远端声明的 HEAD 分支 → 唯一远端分支；全都无法判定时非零退出并如实列出远端实际分支名，绝不瞎猜——「还什么都没推过」只在远端真的一条分支都没有时出现。merge 带来变更时结尾输出技能级统计，且仅当确有新 skill 拉到时才附「新拉取的 skill 尚未分发」的纯文案提醒；本就最新时只输出一行 already up to date。唯一由工具自己解决的冲突：`registry.yaml` 是唯一冲突路径、本地内容是字节级占位 `skills: {}`、且本地历史仅有 init 基线提交这三条同时成立时，远端真实 registry 胜出并在输出中说明——该状态下本地不存在任何用户数据（未 push、无手工提交），否则任何真实 hub 的新机首拉都必然死在这一冲突上（ticket 07）。

退出码语义：`push` / `pull` 在每道硬闸上都非零退出并带指引——未 git 化的 hub（先 `sync init`）、无 remote origin（`sync init --remote <url>` 或手工 `git remote add`）、无 git 身份（工具绝不代为配置）、未出生 HEAD、merge 冲突（冲突状态原样保留，经 `git -C <hub>` 自行解决——上述占位 registry 是唯一的自动解决例外）。`sync status` 是例外：未 git 化的 hub 友好提示（点名 `sync init --remote <url>`）并退出 0。`status` 报告 git 化与否、remote、脏文件数、ahead/behind（基于 remote-tracking ref、注明「上次 fetch」口径——它自己绝不 fetch）、最近同步 commit；`--json` 为机器可读形态；`--share` 输出隐私安全粘贴卡（gitified?/remote yes|no/脏文件/ahead-behind/最近 subject——永不含 hub 路径或 remote URL）并带 Try/Reproduce CTA。bootstrap 绝不 git 化 hub——同步是用户的显式选择。见 [ADR-0020](adr/0020-hub-git-sync-mvp.md)。

### 副本过期与自动刷新（ADR-0008）

`copy` 模式的目标在技能库内容变化后会落后于技能库；symlink 目标始终直连技能库实时内容，永不过期。过期判定只看 fingerprint，刷新是整棵受管子树替换（受管副本目标里的本地文件不会保留——技能库是唯一权威）。

- `add` / `update` **级联**：技能库写入成功后，自动刷新所涉技能的每个过期副本目标；单条失败记录在索引条目上，不阻断兄弟目标。
- `skills-manager status` 输出 `outdated: N, errored: M`，列出刷新错误的运行时路径，并给出修复命令。
- `skills-manager redistribute --refresh`（`--outdated` 的别名）刷新全部过期副本目标，可用 `--to` / `--project` 过滤；输出 `Refreshed N, errored M.`
- `add` / `update` 在仍有其他过期目标时，末尾追加一行提醒。
- 仪表盘的技能行显示带数量的过期徽标和一键刷新按钮。

### update --check（诚实新鲜度）

```sh
skills-manager update --check
```

JSON 分桶：`stale` / `upToDate` / `failed` / `skipped`（及 `checked`）。**git / marketplace** 源的更新信号是 **skill 子目录 tree SHA**——该 skill 目录外的上游提交不会点亮更新（README 差异化主张）。URL / well-known / local 源仍用各自锚点（内容摘要 / 指纹）。`--check` 同时在 **stderr** 打印 tree-SHA 提示，stdout JSON 保持脚本稳定。

### cost（常驻成本账本，ADR-0018）

```sh
skills-manager cost              # 人读视图：路径组 → per-skill 行 → 总计 + unmanaged 行 → 建议
skills-manager cost --json       # 完整账本的 JSON（机器形态）
skills-manager cost --top 10     # 加宽最贵 description 清单（默认 5）
skills-manager cost --share     # 可粘贴分享卡（无绝对路径），适合发 X / HN / 聊天
skills-manager cost --budget 2000  # 常驻总 token 超过 2000 时退出 1（CI / pre-commit 闸；结论走 stderr，stdout 不变）
skills-manager update --check --fail-on-stale  # 任一 skill 过期时退出 1（树 SHA 新鲜度 CI 闸；检测失败本就退出 1；stdout JSON 不变）
```

`cost`（`--top`/`--budget` 不是非负整数、`--json` 与 `--share` 同用）与 `update`（`--fail-on-stale` 未带 `--check`）的参数错误会在解析 hub 之前报出：在全新的 CI runner 上写错参数，看到的是参数本身的错误，而不是「No skill home」。

`cost` 是只读的常驻成本账本：每个已分发 skill 经 frontmatter `name + description` 按条消息计费的常驻 token 成本，按**物理运行时路径**分组（user 与 project 同账；共享路径只计一次并标注 agent family；foreign 条目不逐条计费，只汇总为一行未计数数量）。计数口径为 **char-approx**（CJK 字符 ×1、其余 ÷4，零依赖）——量级参考而非精确计数：展示数字一律 `≈` 前缀（`≈1.2k` 风格缩写），JSON 携带 `method: "char-approx"`。JSON 为三层结构：`paths[]`（各含 `runtimeDir`、`kind`、`agents`、per-skill 行）、顶层 `totalTokens`、以及 `suggestions` 对象。不可读条目（含 broken symlink）计 0 并进 `errors`；缺 description 的条目标记 `incomplete`。

`cost --share` 把同一本账本收成短粘贴卡：总量、路径 kind + agent family（从不带绝对路径）、最重的三个 skill，末尾是 `Try:` / `Reproduce:` 页脚与仓库链接——分享「skill 税」时不泄露家目录，也不再循环写「Share: cost --share」。

`doctor --share` 是并行的 hub 健康粘贴卡：skill / managed / outdated / foreign 计数、常驻成本量级、security high 计数 + scanner id、告警条数——从不带 `skillHome`、断链路径、技能名或告警原文。页脚为 `Try:` / `Reproduce:` + 仓库链接。

建议**只报告不执行**——永远不会代为运行任何命令。三层：archived-but-distributed（零争议收回）置顶，其后是最贵 description top-N，最后是 scattered 分发（同一 skill 散布多条路径——归并到一条）。每条建议附逐字可运行的 `undistribute` 命令，含必需的 `--to`（project 路径带 `--project`）。`doctor` 消费同一核心，输出结构化 `residentCost` 字段且仅在 scattered 重复分发时告警；dashboard 经 `GET /api/cost` 消费。见 [ADR-0018](adr/0018-resident-cost-ledger.md)。同一份 doctor 报告还带结构化 `security` 汇总（`scanner`、`scanned`、`high`、`skillsWithHigh`），仅当 `high > 0` 时告警，并指向 `audit security --strict` 与可拷贝的 Action 示例。


### audit overlap（争抢同一请求的 skill）

```sh
skills-manager audit overlap                 # 比较所有未归档 hub skill
skills-manager audit overlap a b c           # 只比较这些 skill
skills-manager audit overlap --threshold 0.5 # 只报更接近的对（默认 0.3）
skills-manager audit overlap --strict        # CI 闸：报出任一对即退出 1
skills-manager audit overlap --json
```

agent 选 skill 时，是拿你的消息去匹配每个 skill 的 `name + description`。两个 description 抢同一批触发词（比如 `jest-unit-tests` 与 `testing-conventions`）时，agent 可能加载错的那个，也可能一个都不加载。`audit overlap` 离线、确定性地找出这些对：不调模型、不联网。它对 description 词项（ASCII 单词、轻度复数归并、CJK 二元组，并去掉常见虚词）计算 IDF 加权 Jaccard 作为每对的分数，所以人人都用的词几乎不计分，起作用的是有区分度的共享词。每对列出最有区分度的共享词和一条修复建议：在双方 description 里写明边界（「X 的情况请用另一个 skill」），或者把两者合并。只报告，从不改 description。`--json` 输出 `{ method: "idf-jaccard", threshold, scanned, pairs[] }`。带 `--strict` 时结论写 stderr，stdout 不变。

### audit security（装前安全扫描 MVP）

```sh
skills-manager audit security              # 扫描技能库中所有未归档 skill
skills-manager audit security my-skill     # 指定一个（或多个）skill 名
skills-manager audit security --strict     # CI 闸：仅 high 严重度发现时退出 1
skills-manager audit security --format github   # Actions ::error/::warning/::notice（PR Files 页）
skills-manager audit security --strict --format github  # CI 闸 + 注解
```

默认只报告不阻断：扫描 skill 目录树中的高信号风险——shell 执行模式（`bash -c`、`child_process`、`subprocess`、`eval` 等）、网络调用（`curl`/`wget`/`fetch`/…）、凭据路径提及（`~/.ssh`、`.aws/credentials`、`.env` 等）、以及明显像密钥的字符串（AWS key id、私钥头、`sk-…`、`api_key="…"`）。install / update 仍只打 stderr 摘要，永不阻断。

默认 stdout 为 JSON（单个报告对象；扫描多个时为数组）。每份报告含 `scanner`（当前为 `builtin-v1`）、`findings[]`（`kind`、`severity`、相对 `path`、1-based `line`、`excerpt`、`rule`）以及按 kind 汇总的 `summary`。`add` / `update` 成功后还会对每个已安装/已更新的 skill 在 stderr 打一行摘要，保持既有 stdout JSON 可解析。

`--format github` 把 stdout 换成 GitHub Actions 工作流命令（`::error` / `::warning` / `::notice`），`file=` 使用 hub 相对路径 `skills/<name>/…`，让 finding 直接亮在 PR Files 页。与 `--strict` 联用即可既失败又注解。路径与摘录中的 `%` / 换行 / 回车按 Actions 规则做百分号编码。未知 `--format` 值报错 `invalid_format_flag`。

`--strict` 是可选 CI 闸：只要有任意 `severity: high` 的 finding，进程退出码为 `1`（与任一 format 均可联用）。`warn` / `info` 在 `--strict` 下也不失败（单独的 `curl` 提及不得打断流水线）。不加该旗标时，即使有 high 也保持退出 `0`。

可拷贝的 GitHub Actions 工作流：[`examples/github-actions/audit-security.yml`](../examples/github-actions/audit-security.yml) ——跑 `audit security --strict --format github`，在已有 hub 根目录（`skills/` + `registry.yaml`）；CI 里不要传 `--home`（显式 home 会自动创建缺失的 hub，空扫描会以 0 退出掩盖配置错误）。

`doctor` 始终附带同一 hub 汇总为 `security` 字段，且仅当 `high > 0` 时告警（仅有 warn/info 保持沉默），一眼健康检查即可指向 CI 闸，不必另跑 `audit`。

扫描器实现 `SecurityScannerPort`——未来 SkillSpector / 第三方适配器可替换 `builtin-v1`，无需改调用方。

### check（所有 hub 闸，一个退出码）

`skills-manager check` 一次跑完 hub CI 闸，任一失败即退出 1：**security**（存在 high 发现，同 `audit security --strict`）与 **provenance**（imported-without-source，同 `provenance list --fail-on-imported`）始终离线运行；`--budget <tokens>` 追加常驻成本闸（同 `cost --budget`），`--freshness` 追加联网的树 SHA 检查（stale 或检测失败即失败，同 `update --check --fail-on-stale`）。每个闸一行 `PASS`/`FAIL` 加总结论；`--json` 输出 `{ ok, gates[] }`。可拷贝工作流：[`examples/github-actions/hub-check.yml`](../examples/github-actions/hub-check.yml)。

### get（引用层，ADR-0017）

```sh
skills-manager get <skill>            # 完整 SKILL.md（frontmatter + 正文）打到 stdout
skills-manager get <skill> --path     # canonical 技能库目录（绝对路径），用于只读借用
```

`get` 是零留存读取通道：技能库里的技能不分发也能读。它把 SKILL.md 原样打到 stdout —— 纯文本而非 JSON（沿用 `status` 的人类可读先例），agent 可直接管道取用正文；frontmatter 携带 provenance 镜像（见下节），读取顺带获得来源可信度。不要求也不查看任何分发状态。`--path` 改为打印技能库目录的绝对路径——canonical 的 `skills/<name>/` 目录，已归档技能则是 `.skills/archive/…` 目录——作为 stdout 首行，随后附一行只读提示。它用于读取附属文件（scripts、参考资料）：只读借用——技能库是唯一权威，改动走 skills-manager 命令，绝不向该目录写入。已归档技能仍可读取（archive 退出的是管理面——更新、分发——不是可读性）：正文原样输出，归档提示走 stderr，stdout 保持逐字节不变。名字未命中时报错并给出近似名建议（复用既有编辑距离逻辑）。

### frontmatter provenance 镜像（ADR-0017）

registry 保持唯一 source of truth；SKILL.md frontmatter 的 `metadata:` 块是来源证据的**单向便携镜像**——证据随文件行走：进项目副本、给同事、被其他工具读取。镜像在每个 registry 来源写入点刷新：`add`（安装）、`update`、`edit --source-*`、`provenance adopt`、更新检测校准（顺带幂等补写存量技能——无迁移命令）。手改或过期的镜像会在下一个写入点被静默覆盖；改源的正门是 `edit --source-*`。重投影保留其余全部 frontmatter 键——包括其他工具写入的键。

按源类型的键位：

- **git / github / marketplace** 源逐字镜像 gh skill 的四个键——`github-repo`（完整 HTTPS URL）、`github-ref`、`github-tree-sha`、`github-path`。这是有意的键位对齐：`gh skill update` 凭这些键直接互认并更新 skills-manager 装的技能，携带镜像的项目副本同样可被识别。反方向也成立：`gh skill` 装的技能带同样的键，`init` / `provenance adopt` 把它们反读为证据（frontmatter 优先、lockfile 其次），且 `github-tree-sha` 直写更新锚点——证据即校准。
- **wellknown** 源镜像 `skills-manager-source-url`（索引 URL）+ `skills-manager-digest`；**url**（直下）源镜像 `skills-manager-source-url` + `skills-manager-content-sha` —— 自有命名空间键，绝不发明假的 `github-*` 名。
- 每个镜像都带工具签名：`skills-manager-written-by`（+ `skills-manager-version`）。
- **archive / local** 源不写镜像（无更新资格，无假证据）；内置种入的 manager skill 同样豁免。

镜像写入与任何编辑一样计入内容指纹——过期副本目标走既有 auto-refresh 收敛（ADR-0008）。skills-manager 永不写 `~/.agents/.skill-lock.json`（ADR-0011）。见 [ADR-0017](adr/0017-frontmatter-portable-provenance-mirror.md)。

### provenance（来源补齐）

`provenance list` 列出所有仍缺可用来源的技能，分为 **imported-without-source**（经 init 进入、无证据也无补录来源）与 **本地自建**（从未导入、无上游记录）两类；已归档技能不列入。`--fail-on-imported` 是 CI / hub 卫生闸：imported-without-source 非空时退出 1（这类 skill 拿不到树 SHA 更新）；本地自建永不触发失败；结论走 stderr，stdout 列表/JSON 不变。`provenance adopt` 对该存量导入队列重跑导入时的证据采纳 —— 与 init 同一套门禁，仅去掉「本轮新导入」条件。两条证据通道、frontmatter 优先（ADR-0017）：SKILL.md 自身的 `metadata:` 镜像覆盖 gh skill 装的与 skills-manager 自己写的；`npx skills` 锁文件（ADR-0011）覆盖其余。它从不猜测：两条通道都无证据的技能直接跳过（`no_evidence`）。`--dry-run` 仅预览；`--skill` 限定范围。搜索得来的候选不归这个命令管 —— 猜测性来源属于 agent 会话，经用户逐条拍板后才能通过 `edit` 写入（ADR-0012）。见 [ADR-0012](adr/0012-provenance-backfill-agent-assisted.md)。

### init（反向导入）

`init` 是 distribute 的反向操作：扫描**检测到的目录 agent 的全局运行时目录**（`~/.claude/skills`、`~/.cursor/skills`、…），把发现的技能导入技能库，并把每个原位置变成指回 `skills/<name>/` 的受管软链接（原内容会先移入 `<home>/.backups/`；备份 30 天后过期）。导入条目标记 `imported: true`；来源从不猜测，但**有证据就采纳**（[ADR-0011](adr/0011-init-adopts-lockfile-evidence.md)）—— ADR-0011 之前导入的存量技能可用 `provenance adopt` 补采证据。CLI 是非交互的：冲突默认跳过，除非这次导入声明了 **冲突优先级**（`--prefer <运行时目录|agent-id|hub...>`）或逐条 `--resolve`。`--prefer` 里第一个真正持有该技能的来源胜出；`--resolve` 覆盖单个技能。整树指纹相同的副本算同一实体，不是冲突。prefer 项必须是 `hub` 或本轮扫描到的目录。Dashboard 导入面板是同一套列表。见 [ADR-0006](adr/0006-init-reverse-import-symlinks.md) 与 [ADR-0009](adr/0009-init-conflict-priority.md)。

## Agent 目录快照

agent 表（id、运行时路径、检测规则）以内置快照的形式随包分发，提取自 [vercel-labs/skills](https://github.com/vercel-labs/skills)（MIT；文件内有署名）。`skills-manager catalog info` 显示快照戳（上游 commit、日期、年龄）和检测到的 agent 集合 —— 与 `npx skills` 不带 `-a` 时的判定一致。`skills-manager catalog refresh` 重新下载上游、重新提取，并把更新的快照存为技能库本地的覆盖文件 `<home>/.skills/agent-catalog.json`；当生效快照超过 90 天时 doctor 会告警。

开发期间重新生成内置快照：`pnpm run catalog:extract`（下载 `src/agents.ts` + `src/detect-agent.ts`，提取后写入 `src/core/catalog/agent-catalog.json`）。

`<source>` 可以是 GitHub 简写（`owner/repo`）、Git URL、GitHub tree URL 或本地路径。

## 控制台（web）

```sh
skills-manager web --home ~/.skills-manager
skills-manager web --no-open
```

`--port`（默认 `4777`）必须是 0–65535 的整数；否则在检查 hub、启动服务之前就以参数错误退出 1。

控制台由 Fastify 路由驱动，提供本地 Vue/Vite 界面。控制台中的写操作会向 `.skills/activity.jsonl` 写入活动记录，磁盘变更保持对 `git diff` 可见。

## 开发

```sh
pnpm install
pnpm run build
pnpm test
```

测试套件包含编译产物覆盖：`tests/cli/cli-bin.test.ts` 以真实子进程启动 `dist/cli.js`（技能库解析、help、migrate-views），`tests/package/package-smoke.test.ts` 打包 tarball、安装到临时目录，并驱动安装后的 bin 与控制台 API。
