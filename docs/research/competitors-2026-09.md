# Skills 管理赛道竞品调研（2026-09）

> 调研日期：2026-09-15。
> 调研目的：盘点 2026-09 时点上和 skills-manager 同赛道或邻近的 CLI / TUI / 平台 / 标准层玩家，校准「谁是真正的对手」「谁是邻居」「谁是隐性基线」，并落到我们下一阶段的差异化主张上。
> 调研方式：WebSearch（GitHub Blog、官方 manual、社区仓库、NPM/PyPI、综述类文章）；不抓源码级证据（粒度与 `npx-skills-download-strategy.md` 区分；那份是单点深挖，本份是赛道扫描）。
> **修订 2026-09-15**：本文已经一手信源深挖验证并修正（官方 manual / 仓库 README / REST API 实测），逐条核对与新发现见 [competitors-deep-dive-2026-09.md](competitors-deep-dive-2026-09.md)。主要修正：`gh skill` 覆盖 **48 个 agent**（非 5+）；`xingkongliang/skills-manager` 是**模型同构的正面对手**（非名字噪音）；`antfu/skills` 是个人集合 PoC（非「skills npm 路线」，该路线真实代表是 TanStack/intent）。
> 结论先行：**最大威胁已经从 `vercel-labs/skills`（`npx skills`）转移到 GitHub 官方的 `gh skill`（2026-04 公开预览，CLI 2.90+，`--agent` 实际支持 48 个）。** 两者都用「skill 子目录 git tree SHA」做更新检测，provenance 模型高度同构。我们剩下的可守之地只有「hub + distribute + manager-skill-first 引导 + dashboard + 四类源 + 跨 agent 一致性」这条组合。其余 6 个独立 CLI/工具是同一思路的不同工程实现，多数会被协议层（well-known / Anthropic marketplace）收编；obra/superpowers 是体量最大的内容+方法论社区，结构性威胁来自「它的 CLI 一旦补齐跨 agent 分发」。

## 1. 同赛道 CLI / TUI（直接对标）

### 1.1 `vercel-labs/skills` —— `npx skills`

- **现状**：`npx skills`，npm 包 `skills`（v1.5.24 latest，2026-09-08 时点），TypeScript，~26K★，`vercel-labs/agent-skills` 是其官方 skill 集合（~29K★）。
- **三段下载路径**：白名单 owner 走 blob 快照（纯 HTTP，非 git）；其余 GitHub 走 `--depth 1`；GitLab / 任意 git URL 一律 `--depth 1`。**永不全克隆**。
- **更新检测**：先打一次 GitHub Trees API（`?recursive=1`），比对 skill 子目录 tree SHA，无变化 0 次 clone；不可用才回退 clone + `rev-parse HEAD:<folder>`。锁文件 `.skill-lock.json` schema v3，字段 `skillFolderHash` 即目录 tree SHA。
- **关键工程细节**：`GIT_LFS_SKIP_SMUDGE=1`、`GIT_ALLOW_PROTOCOL=https:http:ssh:git:file` 白名单、tmpdir + 用后删 + 删除前路径校验、认证三级回退 HTTPS → gh CLI → SSH、超时分 10s/30s/5min。
- **调研出处**：`docs/research/npx-skills-download-strategy.md`（已有源码级调研）。
- **vs skills-manager**：和我们的差异是「hub + distribute + dashboard + manager-skill-first + 四类源」这条组合；GH-side 的「上游目录级 hash + Trees API 去 clone」更新链路**正是 ADR-0013 tree-SHA + shallow clone 的同构选择**，是我们必须做对的基线。

### 1.2 `gh skill` —— **最大威胁**

- **现状**：GitHub CLI v2.90.0+ 公开预览子命令，2026-04-16 发布；GitHub Blog 公告、官方 manual、Arch Linux man page、社区多家媒体跟进（azukiazusa / mer.vin / tricuatro / machineherald 等）。
- **子命令**：`search`（Code Search API 找 SKILL.md）/ `preview`（安全闸，先看再装）/ `install` / `list` / `update [--all]` / `publish [--fix] [--dry-run]`。`gh skills` 是同一命令组的别名。
- **覆盖 agent**：官方 manual 逐项列出 **48 个 `--agent` 值**（github-copilot 为非交互默认；Claude Code、Cursor、Codex、Gemini CLI、Antigravity、Amp、Cline、OpenCode、Warp、universal 等；Blog 只突出 6 个头条 host）。scope `project`（默认）| `user`。
- **Provenance 模型**：和 npx skills **几乎完全同构**——SKILL.md frontmatter 记 `tree SHA`，更新只在上游 tree SHA 真变化时触发；用 `--pin <tag|sha>` 锁版本，被锁的 skill 不参与 `--all` 自动更新。
- **安装语法**：
  ```bash
  gh skill install github/awesome-copilot documentation-writer@v1.2.0 --agent claude-code --scope user
  gh skill preview github/awesome-copilot documentation-writer   # 安全闸
  ```
- **关键差异**：
  - GitHub 官方 + 跨平台渠道（用户装 gh 时自动可得，无需单独装包）。
  - 用 Code Search API 做发现层（搜索范围远超单一 registry）。
  - `publish` 把规范校验和发布绑在一起，相当于把 `skill-creator` 流程内化进了 CLI。
  - 内容源默认是 GitHub 仓库，对非 GitHub 源（zip / archive / marketplace / well-known）未表态；但已有 `--from-local` 本地安装（copy 而非 symlink，frontmatter 注入 local 追踪 metadata）。
  - 深挖补充（`--upstream` 防二手转发、update 对无源 skill 交互询问来源 = 简版 provenance backfill、publish 可启用 immutable releases + secret/code scanning 检查、frontmatter 便携 provenance 定位）见 deep-dive §1。
- **vs skills-manager**：
  - 优势面：GitHub 品牌 + 已装用户基数 + publish 流程 + Code Search 发现 + **`.agents/skills` 共享目录（project scope 下多 agent 一份内容、只写一次）**。
  - 短板面：user scope 跨 agent 仍需逐个 `--agent`；不显式建模 hub、无 distribute/undistribute 生命周期与 stale 检测回滚；publish 强绑 GitHub 仓库。
  - **真正的差异化空间**：hub + distribute 模型（同一份 canonical 内容分发到任意 agent × 任意项目）、copy/symlink 双模式、stale 检测 + 回滚、manager-skill-first 引导、四类源（不只是 GitHub）、dashboard、provenance backfill（adopt + search + approve 三层）。

### 1.3 `openskills`（numman-ali）

- **现状**：npm 包 `openskills`，v1.0.0 首发 2025-10，v1.5.0（2026-01）加 `update`；Node.js 20.6+，Apache 2.0，~10.7K★。
- **定位**：「把 Anthropic SKILL.md 协议 100% 兼容搬到所有 agent」——同 XML 格式、同 `.claude/skills/` 目录结构、同 YAML frontmatter 规范、同渐进加载模型。
- **核心选择**：用 CLI 代替 MCP——理由是 skills 是静态文件 + 资源，不需要 server。**这条论证正好是我们选 manager-skill + CLI 路线而非 MCP server 的间接背书。**
- **命令**：`install` / `sync`（生成 AGENTS.md）/ `list` / `read <name>[,name2]` / `update` / `manage`（交互删除）/ `remove`。
- **路径选项**：`~/.claude/skills`（默认 / `--global`）/ `./.claude/skills`（项目）/ `./.agent/skills`（`--universal`）/ `~/.agent/skills`（`--global --universal`）。
- **vs skills-manager**：协议共生——同源同格式，但缺 hub+distribute+dashboard+四类源。`update` 命令在 v1.5.0 才补齐，且只对带 source metadata 的 skill 生效（其余要求重装），成熟度尚浅。**⚠ 实质停更（2026-09-15 实测：最后 push 2026-01-18）**——不再是需要盯防的活体竞品；其「AGENTS.md + `<available_skills>` XML 让任何 agent 可读」的机制仍值得借鉴。
- **注意点**：**同名/近名项目存在（rferrari / Zpankz / Smarty-Pants-Inc / akaihola / seenbefore 等多个 fork）**，主要分发仓是 `numman-ali/openskills`；社区对「universal skills loader」这个定位的接受度本身是个观察指标。

### 1.4 `asm`（luongnv89/asm）

- **现状**：Node CLI（npm 包名 `agent-skill-manager`，与 jroslaniec 仓库名撞车），**覆盖 21 providers**（Claude Code / Codex / Cursor / OpenCode / Agents / Pi 等），930★、2026-09 仍活跃。**被旧版低估**：独有 attention budget（`stats --tokens` 常驻 vs body 成本核算）、residency audit + 降级阶梯（installed→saved→disabled→reference）、`asm get` 零留存引用层、library 模式（装库不挂载 + 按需 symlink，即 hub 雏形）。详见 deep-dive §3。
- **差异化**：
  - **Bundle 概念**：`asm bundle install frontend-dev` 这类「场景化套件」是一手好牌。
  - **Audit / security 子命令**：内置安全审计。
  - 私有仓库走 SSH。
- **vs skills-manager**：覆盖 agent 数最多（与我们的 catalog 73 个同量级，但 asm 没明说数据来源）；bundle 是值得借鉴的「场景化分发」表达。

### 1.5 `sm` / `agent-skill-manager`（jroslaniec，Rust）

- **现状**：Rust 单二进制分发，`curl … | sh` 安装；symlink + 缓存仓库；交互 TUI；`repo auto-upgrade`。**体量警示（2026-09-15 实测）：仅 1★、最后 push 2026-06-14、内置 integration 仅 2 个（claude-code、`~/.agents/skills` 共享目录），其余靠 `--path` 自定义。**
- **vs skills-manager**：性能与分发形态占优（单二进制 → 更小更快），但功能广度、生态、内容源类型都明显窄。

### 1.6 `skm-cli`（PyPI）

- **现状**：Python，YAML 声明式，`~/.config/skm/skills.yaml` 描述目标，幂等 sync + `skills-lock.yaml`。
- **vs skills-manager**：声明式 vs 命令式路线之争。声明式在「让 dotfiles 仓库接管配置」的 Pro 用户里会有一席之地；和我们的 hub+distribute 模型在心智模型上不同。

### 1.7 `skill-manager`（iyangdianfeng，Deno）

- **现状**：Deno 运行时；命令最多：`list/search/show/load/init/validate/set/export/install/uninstall`。
- **vs skills-manager**：`load` 命令独立暴露（agent 主动调用）的设计和我们 manager skill 内部 invoke CLI 的做法异曲同工；可以看作「轻量 manager skill 替代品」。**降权（2026-09-15 实测）：0★、AGPL、2026-01 后停更——从对标清单降为脚注。**

### 1.8 `cc-switch`

- **现状**：Claude Code / Codex 配置切换器（provider、prompt 等），skills 是其中一块。
- **vs skills-manager**：定位偏 provider 切换，我们偏 skills 内容管理，是相邻而非重叠。已被列为对标基准（`source-formats-feature` memory）。

### 1.9 同名 / 近名噪音

- `xingkongliang/skills-manager`（4,743★，Rust/Tauri 系桌面版，2026-09 仍活跃）——**正面撞车对手，非名字噪音（2026-09-15 修正）**：hub 默认路径同为 `~/.skills-manager`、**54 agents**、symlink/copy 双模式 sync、**presets**（命名技能组一键启停）、**manage-skills skill**（agent 驱动管理，与我们 manager skill 同命题）、私有 GitHub repo 备份 + **多机同步（skill 级合并 + 冲突策略 + 快照恢复）**、内嵌 CLI 且自身以 skill 形态发布（`npx skills add xingkongliang/skills-manager`）。我们仍独有：CLI-first（可脚本化/CI）、url/well-known 源、tree-SHA 更新锚点、provenance backfill 三层、stale 检测 + 回滚。详见 deep-dive §6。
- 我们自己的 `skills-manager-cli` 是已占据的包名，被搜到时必须强占首位。

## 2. 内容 / 生态平台（不是工具，但会演化为上游或对手）

| 项目 | 性质 | 体量 | 风险 / 机会 |
|---|---|---|---|
| **`obra/superpowers`** | agentic skills 方法论 + 框架 | ~257K★ | **体量最大的社区**。一旦把「多 agent distribute」做成一等公民，从内容侧吃掉我们一半场景。 |
| **`antfu/skills`** | Anthony Fu 个人 skill 集合 PoC（2026-09-15 修正：非「skills npm 路线」） | 5,884★ | 靠 `npx skills add antfu/skills` 安装，依赖 vercel-labs CLI。真正「skills 随 npm 包分发」的代表是 **TanStack/intent**（331★，面向库维护者随包生成/校验/分发 skills）。 |
| **`phuryn/pm-skills`** | 100+ skills 市场 | ~22K★ | 内容市场；若自建 CLI 即直接对手。 |
| **`addyosmani/agent-skills`** | 知名个人维护的 skill 集合 | ~81K★ | 内容供给方，对我们无害。 |
| **`calesthio/OpenMontage`** | skill 集合 | ~48K★ | 同上。 |
| **`muratcankoylan/Agent-Skills-for-Context-Engineering`** | context engineering 角度 | ~17K★ | 同上；和我们 source-formats / category-set 路线会有交叉讨论空间。 |
| **`NVIDIA/SkillSpector`** | **skills 安全扫描** | ~14K★ | 完全互补，可演化为上下游。 |
| **`skills.sh`** | 第三方 skills 注册中心 | 持续运营 | 已被我们列入候选方向（`source-formats-feature` memory：「接 skills.sh」）。它若自建 CLI 即直接对手。 |

## 3. 协议 / 标准层（最容易被「标准」反噬）

### 3.1 `agentskills.io` well-known discovery（v0.2.0）

- 我们是早期采纳者，不是发明者（CONTEXT.md 明文）。来源约定 `/.well-known/agent-skills/index.json` 或 `/.well-known/skills/index.json`；v2 单工件 + digest 模型。
- **风险**：标准成熟后所有浏览器式发现都成基础设施。我们必须把「发现 → 安装 → 分发 → 维护」做成端到端不可替代的体验，单做发现层不够。

### 3.2 Anthropic Skills Marketplace

- 2026 年初 TechCrunch 报道 Anthropic 上线 skills marketplace；尚未见正式公告和完整文档，但官方已经在「Claude 内一键装别人 skills」方向投入资源。
- **结构性威胁**：一旦官方做原生 marketplace + 跨 agent 分发，外部独立 hub 的价值会被压缩。
- **我们的护城河**：跨 agent 一致性——把「同一份 skill 在 Claude/Codex/Cursor/Aider/Gemini 上行为一致」做成可证承诺 + 跨 agent 一键迁移。

### 3.3 MCP（Model Context Protocol）

- `openskills` 已经论证：skills 是静态文件 + 资源，不需要 server。**我们选 CLI + manager skill 是对的。**
- **风险**：若 Anthropic 把 skills 包进 MCP，CLI 路径会变窄。需要保留「CLI 可降级到不带 MCP 的纯文件模式」的承诺。

### 3.4 GitHub Copilot Coding Agent + GitHub Actions

- `gh skill` 只是冰山一角；Copilot Coding Agent 一旦原生支持 skills 注册，会直接吃掉 GitHub 用户群。
- 防御：和 GitHub 生态保持互操作（lockfile 互通 / provenance 互认），避免「GitHub 一刀切就封死外部 hub」。

## 4. 与 skills-manager 的横向对比

| 维度 | npx skills | gh skill | openskills | asm | skm-cli | skills-manager |
|---|---|---|---|---|---|---|
| 包身份 | npm `skills` | gh 内置子命令 | npm `openskills` | npm `asm` | pip `skm-cli` | npm `skills-manager-cli` |
| 模型 | 直装 runtime | 直装 runtime | 直装 runtime | 直装 runtime | 声明式 sync | **hub + distribute** |
| Agent 覆盖 | 全 catalog | **48**（manual 逐项列出） | 5（Claude/Cursor/Windsurf/Aider/Codex） | **21 providers** | 4（standard/claude/codex/openclaw） | **catalog 73 个** |
| 源类型 | git / well-known / 本地 / skills.sh | GitHub 为主 | GitHub / 本地 / git URL | git / 本地 | YAML 声明 | **git / url / archive / marketplace / well-known** |
| 更新锚点 | skill 目录 tree SHA | skill 目录 tree SHA + frontmatter | source metadata（v1.5.0 起） | 未明示 | lockfile | skill 目录 tree SHA（ADR-0013） |
| Manager skill / 引导 | 无 | 无 | 无 | 无 | 无 | **manager-skill-first**（ADR-0014） |
| Dashboard | 无 | 无 | 无 | 无 | 无 | **有**（单面 skill library） |
| Provenance backfill | 无 | 无 | 无 | 无 | 无 | **adopt + search + approve**（ADR-0012） |
| Bundle / 场景化 | 无 | 无 | 无 | **有** | 无 | 暂无（候选） |
| Stale 检测 + 回滚 | 无 | 无 | 无 | 无 | 无 | **有**（ADR-0008） |
| 跨项目分发 | 手动重复装 | `--scope repository`（仅 GitHub 源） | 项目级安装 | 项目级安装 | YAML 声明 | **copy / symlink 双模式**（ADR-0003） |

## 5. 对 skills-manager 的战略启示

### 5.1 重新定位「最关键对标」

- **第一对手 = `gh skill`**，不是 `npx skills`。GitHub 品牌 + 跨平台 + provenance 同构 + publish 内化，对我们构成正面竞争。
- `npx skills` 退居「技术参照 + 协议共生」位——继续吃它们的 tree-SHA / shallow clone / GitHub API 决策即可，无需正面抢用户。
- `openskills` 是协议共生位，需要在「同协议不同体验」上做出可见差异（hub+distribute 一步到位）。

### 5.2 守住差异化护城河（与 1.2 / 第 4 节对齐）

1. **Hub + distribute 模型**：一份 canonical 内容，distribute 到任意 agent × 任意项目；copy/symlink 双模式；stale 检测 + 回滚。**`gh skill` 目前没有 hub 抽象、没有项目级双模式、没有 stale 检测**。
2. **Manager-skill-first 引导**：no-arg npx bootstrap → 在 agent 会话里完成所有后续管理动作。**这是 `gh skill` 完全没建模的入口形态**。
3. **四类源 + auto-detection**：URL / archive / marketplace / well-known 是 `gh skill` 不表态的方向，要成为「非 GitHub 源的事实接口」。
4. **Dashboard**：给非终端用户一个可视入口；`gh skill` 仍纯 CLI。
5. **Provenance backfill 三层**：adopt 锁文件证据 / search 生态候选 / approve 用户拍板——把「imported-without-source」这个真实长期问题做成产品特性。
6. **Domain categories + category-set loading**：把 `categories apply` 这种「按领域一键装」做成差异化体验，`gh skill` 没建模。

### 5.3 主动互操作（避免被标准封死）

- 锁文件 schema 与 `.skill-lock.json`（npx skills）保持互认或显式标注不兼容。
- well-known index 持续做早期采纳者，把 `agentskills.io` 索引能力坐实为基础设施默认消费方。
- SKILL.md frontmatter 字段保持与 `gh skill` 同构（owner/repo/ref/tree SHA），让同源 skill 在两套工具间可平移。

### 5.4 候选新方向（基于竞品空白）

- **Bundle / 场景化套件**（借鉴 `asm`）：`skills-manager bundle apply frontend-dev` 这类高层抽象。
- **Create + Push**（`gh skill publish` 已做，我们要更通用）：跨 GitHub / 任意 git host / 直接发布到 well-known index。
- **Find 通道接入 skills.sh**（已记入 `source-formats-feature` memory）：把发现层扩到第三方注册中心。
- **安全扫描 hook**（与 `NVIDIA/SkillSpector` 互补）：在 install/update 时调用第三方扫描，输出到 dashboard 的 doctor 信号。
- **Hub git 同步**（`sync` 已记入候选）：让 hub 自己可被 git 管理，多机器同步。

### 5.5 名字 / SEO 防御

- 在 README、官网、npm description 里主动写「`skills-manager-cli` / `skills-manager`」+ 别名说明，把搜索「skills manager」「agent skill manager」时首位抢到。
- 与 `xingkongliang/skills-manager` 显式区分定位（**紧急**——双方 hub 默认路径同为 `~/.skills-manager`，模型高度同构）：**我们 = CLI-first + npm 包 + 四类源 + tree-SHA 锚点 + provenance backfill + stale 回滚；他们 = 桌面 GUI + presets + 多机同步**。

## 6. 跟踪节奏建议

- **每月一次**：扫 `vercel-labs/skills` release notes、`gh` release notes、`numman-ali/openskills` releases、Anthropic 官方 changelog。
- **每季度一次**：重读本文件，校准第一对手 + 差异化护城河清单。
- **触发性**：若 `obra/superpowers` 或 Anthropic 官方宣布「跨 agent distribute」特性，立即更新第 5 节。
- **新进入者观察清单**（2026-08/09 密集出现，详见 deep-dive §9）：`withastro/rosie`（Astro 团队，「npm but for skills」，lockfile + typed JS API）、`loopdoop/skl`（闭源单二进制，多机精确重建）、`skillfish`（317★）、`TanStack/intent`（331★）、`skillcoffer`（save/restore 不可变存档 + 上游 diff 审查）、`skls-mgr`（集中目录 + skills.sh 命令替换兼容）、`skills.sh` 自建 CLI 动向、`Agent Skills` 规范的官方 reference tool 动向。

## 引用源

- GitHub Blog: [Manage agent skills with GitHub CLI](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/)
- 官方 manual: [gh skill — cli.github.com](https://cli.github.com/manual/gh_skill)
- Arch Linux man: [gh-skill(1)](https://man.archlinux.org/man/extra/github-cli/gh-skill.1.en)
- 实战 walkthrough: [azukiazusa.dev — You Can Now Distribute Agent Skills with the gh Command](https://azukiazusa.dev/en/blog/gh-agent-skill-management)
- 媒体跟进: [mer.vin](https://mer.vin/2026/04/gh-skill-install-pin-and-publish-agent-skills-from-github-repos) / [tricuatro](https://tricuatro.com/en/articles/github-cli-launches-gh-skill-command-to-manage-ai-agent-skills) / [machineherald](https://machineherald.io/article/2026-04/18-github-cli-adds-gh-skill-command-turning-anthropics-agent-skills-standard-into-a-package-manager-for-ai-coding-agents)
- openskills 主仓: [numman-ali/openskills — GitHub](https://github.com/numman-ali/openskills) / [DeepWiki CLI 参考](https://deepwiki.com/numman-ali/openskills/3-cli-commands-reference) / [v1.0.0 release notes](https://newreleases.io/project/github/numman-ali/openskills/release/v1.0.0)
- 其他 CLI: [luongnv89/asm](https://github.com/luongnv89/asm) / [jroslaniec/agent-skill-manager](https://github.com/jroslaniec/agent-skill-manager) / [skm-cli on PyPI](https://pypi.org/project/skm-cli/0.2.0/) / [iyangdianfeng/skill-manager](https://github.com/iyangdianfeng/skill-manager)
- 内容/生态: [Skills.sh registry](https://skills.sh/) / [obra/superpowers](https://github.com/obra/superpowers) / [antfu/skills](https://github.com/antfu/skills) / [phuryn/pm-skills](https://github.com/phuryn/pm-skills) / [NVIDIA/SkillSpector](https://github.com/NVIDIA/SkillSpector) / [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager)
- 协议 / 标准: [Anthropic Skills Marketplace — TechCrunch](https://techcrunch.com/2026/01/anthropic-skills-marketplace) / [MCP and the Future of Agent Registries — LangChain Blog](https://blog.langchain.com/mcp-agent-registries-2026/) / [AI Agent Skill Discovery and Registry Patterns — InfoQ](https://www.infoq.com/articles/ai-agent-skill-discovery-2026/)
- 综述: [2026 AI Skills Marketplace Trends — Medium](https://medium.com/@intelligentagentlabs/2026-ai-skills-marketplace-trends-predictions-baa86d72ac9a) / [The Rise of Skill Marketplaces — LinkedIn](https://www.linkedin.com/pulse/rise-skill-marketplaces-ai-agents/) / [OpenAgentSkill alternatives index](https://www.openagentskill.com/alternatives/antfu-skills-npm)
- 内部对照: `docs/research/npx-skills-download-strategy.md`（2026-09-08，已存在）
