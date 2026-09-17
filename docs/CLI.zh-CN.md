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

bootstrap（ADR-0014）只做四件事：确保技能库存在；从 npm 包内副本把 **manager skill** 种进库（以发布 tag 作为更新来源戳）；把它（软链接）挂载到你选择的 agent —— TTY 下对检测到的 agent 弹多选（默认全选），`--agent` 跳过提问，非 TTY 挂到全部检测到的 agent；最后打印起始提示词。它永远不做导入：导入现有运行时技能是你之后通过 manager skill 在对话里完成的动作。bootstrap 幂等；且 CLI 每次运行都会自检库内副本与包内副本，未被他改时静默刷新（你手改过的副本视为外来物，不再触碰）。

## 命令

```sh
skills-manager web --home ./my-skill-home
skills-manager doctor --home ./my-skill-home
skills-manager catalog info --home ./my-skill-home
skills-manager catalog refresh --home ./my-skill-home
skills-manager list --home ./my-skill-home
skills-manager get my-skill
skills-manager get my-skill --path
skills-manager add <source> --all --yes
skills-manager update --plan
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
skills-manager sync push                  # add -A + 一次技能级汇总提交 + push
skills-manager sync pull                  # fetch + merge（要求干净工作树）
```

hub 本身成为一个 git 仓库；对用户自选的任意远端（本地 bare repo 也可以）push/pull 即是同步的全部机制。`sync init` 幂等，且 **adopt** 既有 `.git/`（历史保留——用户领先一步不是错误），只追加缺失的 canonical `.gitignore` 行——`.backups/` 与 `.skills/` 是机器本地状态（回滚快照、分布索引、活动日志），永不同步，分发是每台机器自己的事——树上还有未提交内容时做一次基线提交，可选挂 origin。输出为零省略的「做了什么」清单，结尾提醒推送前确认 hub 无敏感信息。已有 origin 指向他处时拒绝改指并给出手工命令——绝不静默改。

`sync push` 暂存全部并做一次汇总提交（技能级计数：新增 / 更新 / 移除，registry 旗标；同 skill 内 rename 计为 update）后推送。干净树且远端已一致时输出「已是同步状态」并退出 0——绝不造空提交。`sync pull` 要求干净工作树（脏 → 非零退出，指引先 `sync push` 或手工处理；绝不 stash），随后 fetch + merge（允许 merge commit；不 rebase、不 ff-only）。merge 带来变更时结尾输出技能级统计，且仅当确有新 skill 拉到时才附「新拉取的 skill 尚未分发」的纯文案提醒；本就最新时只输出一行 already up to date。

退出码语义：`push` / `pull` 在每道硬闸上都非零退出并带指引——未 git 化的 hub（先 `sync init`）、无 remote origin（`sync init --remote <url>` 或手工 `git remote add`）、无 git 身份（工具绝不代为配置）、未出生 HEAD、merge 冲突（冲突状态原样保留，经 `git -C <hub>` 自行解决）。`sync status` 是例外：未 git 化的 hub 友好提示并退出 0。`status` 报告 git 化与否、remote、脏文件数、ahead/behind（基于 remote-tracking ref、注明「上次 fetch」口径——它自己绝不 fetch）、最近同步 commit；`--json` 为机器可读形态。bootstrap 绝不 git 化 hub——同步是用户的显式选择。见 [ADR-0020](adr/0020-hub-git-sync-mvp.md)。

### 副本过期与自动刷新（ADR-0008）

`copy` 模式的目标在技能库内容变化后会落后于技能库；symlink 目标始终直连技能库实时内容，永不过期。过期判定只看 fingerprint，刷新是整棵受管子树替换（受管副本目标里的本地文件不会保留——技能库是唯一权威）。

- `add` / `update` **级联**：技能库写入成功后，自动刷新所涉技能的每个过期副本目标；单条失败记录在索引条目上，不阻断兄弟目标。
- `skills-manager status` 输出 `outdated: N, errored: M`，列出刷新错误的运行时路径，并给出修复命令。
- `skills-manager redistribute --refresh`（`--outdated` 的别名）刷新全部过期副本目标，可用 `--to` / `--project` 过滤；输出 `Refreshed N, errored M.`
- `add` / `update` 在仍有其他过期目标时，末尾追加一行提醒。
- 仪表盘的技能行显示带数量的过期徽标和一键刷新按钮。

### cost（常驻成本账本，ADR-0018）

```sh
skills-manager cost              # 人读视图：路径组 → per-skill 行 → 总计 + unmanaged 行 → 建议
skills-manager cost --json       # 完整账本的 JSON（机器形态）
skills-manager cost --top 10     # 加宽最贵 description 清单（默认 5）
```

`cost` 是只读的常驻成本账本：每个已分发 skill 经 frontmatter `name + description` 按条消息计费的常驻 token 成本，按**物理运行时路径**分组（user 与 project 同账；共享路径只计一次并标注 agent family；foreign 条目不逐条计费，只汇总为一行未计数数量）。计数口径为 **char-approx**（CJK 字符 ×1、其余 ÷4，零依赖）——量级参考而非精确计数：展示数字一律 `≈` 前缀（`≈1.2k` 风格缩写），JSON 携带 `method: "char-approx"`。JSON 为三层结构：`paths[]`（各含 `runtimeDir`、`kind`、`agents`、per-skill 行）、顶层 `totalTokens`、以及 `suggestions` 对象。不可读条目（含 broken symlink）计 0 并进 `errors`；缺 description 的条目标记 `incomplete`。

建议**只报告不执行**——永远不会代为运行任何命令。三层：archived-but-distributed（零争议收回）置顶，其后是最贵 description top-N，最后是 scattered 分发（同一 skill 散布多条路径——归并到一条）。每条建议附逐字可运行的 `undistribute` 命令，含必需的 `--to`（project 路径带 `--project`）。`doctor` 消费同一核心，输出结构化 `residentCost` 字段且仅在 scattered 重复分发时告警；dashboard 经 `GET /api/cost` 消费。见 [ADR-0018](adr/0018-resident-cost-ledger.md)。

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

`provenance list` 列出所有仍缺可用来源的技能，分为 **imported-without-source**（经 init 进入、无证据也无补录来源）与 **本地自建**（从未导入、无上游记录）两类；已归档技能不列入。`provenance adopt` 对该存量导入队列重跑导入时的证据采纳 —— 与 init 同一套门禁，仅去掉「本轮新导入」条件。两条证据通道、frontmatter 优先（ADR-0017）：SKILL.md 自身的 `metadata:` 镜像覆盖 gh skill 装的与 skills-manager 自己写的；`npx skills` 锁文件（ADR-0011）覆盖其余。它从不猜测：两条通道都无证据的技能直接跳过（`no_evidence`）。`--dry-run` 仅预览；`--skill` 限定范围。搜索得来的候选不归这个命令管 —— 猜测性来源属于 agent 会话，经用户逐条拍板后才能通过 `edit` 写入（ADR-0012）。见 [ADR-0012](adr/0012-provenance-backfill-agent-assisted.md)。

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

控制台由 Fastify 路由驱动，提供本地 Vue/Vite 界面。控制台中的写操作会向 `.skills/activity.jsonl` 写入活动记录，磁盘变更保持对 `git diff` 可见。

## 开发

```sh
pnpm install
pnpm run build
pnpm test
```

测试套件包含编译产物覆盖：`tests/cli/cli-bin.test.ts` 以真实子进程启动 `dist/cli.js`（技能库解析、help、migrate-views），`tests/package/package-smoke.test.ts` 打包 tarball、安装到临时目录，并驱动安装后的 bin 与控制台 API。
