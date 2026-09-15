# 竞品一手信源深挖报告（2026-09）

> 调研日期：2026-09-15。
> 调研目的：对 `competitors-2026-09.md` 中的每条竞品主张做**一手信源验证**（官方 manual / GitHub Blog / 仓库 README / PyPI JSON API / npm registry / GitHub REST API），并深挖实现细节（下载策略、provenance 锚点、agent 检测、安全防护、分发形态）。
> 调研方式：全部结论以一手信源为准；每条主张标注「已验证 ✅ / 与主张不符 ❌ / 未能验证 ⚠」。体量数据（star 数）取自 GitHub REST API / shields.io（2026-09-15 时点）。
> 结论先行：**三条旧判断需要推翻修正——① `gh skill` 的 agent 覆盖是 48 个（官方 manual 逐项列出），不是"5+"，且已有 `.agents/skills` 共享目录（一份装、多 agent 用）、`--from-local`、update 时的 provenance 询问，威胁比旧文档评估更高；② `xingkongliang/skills-manager` 不是"名字噪音"，它是与我们模型高度同构的正面对手（hub 默认路径就是 `~/.skills-manager`、有 presets、有 manage-skills skill、有 git backup 多机同步、54 个 agent、桌面 GUI + 内嵌 CLI）；③ `antfu/skills` 不是"Skills Npm"路线（78K★ 也不属实），它只是 Anthony Fu 的个人 skill 集合 PoC，真正的"skills 随 npm 包分发"玩家是 TanStack/intent。** 另发现一批 2026-08/09 新竞品（withastro/rosie、useskl/skl、skillcoffer、skls-mgr、skillfish 等），多为小体量早期项目，但 Astro（rosie）入场值得跟踪。

---

## 1. `gh skill`（GitHub CLI 子命令）——最大威胁，且被旧文档低估

信源：官方 manual 六个子命令页（gh_skill / gh_skill_install / gh_skill_update / gh_skill_publish / gh_skill_preview / gh_skill_list / gh_skill_search）+ GitHub Blog changelog（2026-04-16）。

### 1.1 逐条核对旧文档主张

| 旧文档主张 | 验证结果 | 说明 |
|---|---|---|
| 2026-04-16 发布、CLI 2.90+ 公开预览 | ✅ | Blog 原文："Update the GitHub CLI to version v2.90.0 or later"；"launching in public preview" |
| 子命令 search/preview/install/list/update/publish，`gh skills` 别名 | ✅ | manual 完整列出；另有别名 `gh skill add`/`gh skill ls`/`gh skill show` |
| 覆盖 agent「5+（Copilot/Claude/Cursor/Codex/Gemini/Antigravity）」 | ❌ **严重低估** | `gh skill install` manual 逐项列出 **48 个 `--agent` 值**（github-copilot、claude-code、cursor、codex、gemini-cli、antigravity 及 43 个更多：amp、cline、continue、crush、devin、droid、goose、grok、junie、kilo、opencode、openhands、replit、roo、trae、warp、zencoder、**universal** 等）。Blog 只突出 6 个头条 host。我们 catalog 73 个 vs gh 48 个，数量优势缩小 |
| scope `user` \| `repository` | ⚠ 细节有出入 | scope 值是 `project` \| `user`（默认 **project**，不是 Copilot 默认）；默认 agent 是 github-copilot（仅非交互时） |
| SKILL.md frontmatter 记 tree SHA，更新只在真变化时触发 | ✅ | update manual："comparing the local tree SHA (from SKILL.md frontmatter) against the remote repository"。Blog："not just version bumps" |
| `--pin <tag\|sha>` 锁版本，pinned 不参与 `--all` 更新 | ✅ | 且有 `--unpin` 清除锁定；pin 解析为 git tag 或 commit SHA |
| publish 把校验和发布绑定（`--fix`/`--dry-run`） | ✅ 且更强 | publish 还做：加 `agent-skills` topic、选 semver tag、创建 GitHub release；**检查仓库 tag protection / secret scanning / code scanning，并可一键启用 immutable releases**（Blog："even if someone gets control of your repository they cannot change existing releases"） |
| 内容源默认 GitHub，对 zip/archive/marketplace/well-known 未表态 | ✅ | 仍成立；但新增 `--from-local`（见下） |

### 1.2 深挖新发现（旧文档未覆盖）

1. **`.agents/skills` 共享目录 = 半个 hub 分发**（install manual）："At project scope, several agents (including GitHub Copilot, Cursor, Codex, Gemini CLI, Antigravity, Amp, Cline, OpenCode, and Warp) share the `.agents/skills` directory. If you select multiple hosts that resolve to the same destination, each skill is installed there only once." —— 一份内容多 agent 复用的语义已经有了，只是仅限 project scope + 固定目录，没有显式 hub 生命周期（distribute/undistribute/stale 回滚）。
2. **`--from-local` 本地安装**：本地目录自动发现（与远端同约定）、**copy 而非 symlink**、向 frontmatter 注入 local-path 追踪 metadata。
3. **update 的 provenance 询问 = 简化版 provenance backfill**（update manual）："Skills without GitHub metadata (e.g. installed manually or by another tool) are prompted for their source repository in interactive mode... The update re-downloads the skill with metadata injected" —— 与我们 ADR-0012 的 adopt/search/approve 三层同问题域，gh 做了最薄的一层（交互问一句）。
4. **`--force` 恢复本地修改**："re-downloads skills even when the remote version matches... overwrites locally modified skill files with their original content"——相当于"重置到上游"，但**不删除本地新增文件**。
5. **版本解析顺序**：无版本时先「最新 tag release」再「默认分支 HEAD」；`skill@v1.2.0` / `@<sha>` 均可。
6. **大仓库性能提示**：给精确路径（`skills/author/skill` 或任意 `.../SKILL.md`）可跳过全树遍历——发现层的工程细节。
7. **`--upstream`**：检测到 re-published skill 时直接装上游原始源——对"二手转发"场景的防护。
8. **`--allow-hidden-dirs`**：默认跳过 `.claude/skills/`、`.agents/skills/` 等隐藏目录里的 skill。
9. **frontmatter provenance 的可移植论证**（Blog）："Because provenance data lives inside the skill file itself, it travels with the skill no matter where it ends up" —— 锚点放 SKILL.md frontmatter（而非独立 lockfile）被 GitHub 明确定位为**可移植性优势**。

### 1.3 仍然没有的（差异化空间维持但收窄）

hub 抽象（集中库 + distribute/undistribute 生命周期）、user scope 下的一键多 agent（仍需逐个 `--agent`，或依赖 `.agents/skills` 约定）、非 GitHub 源（url/archive/well-known）、stale 检测 + 回滚、manager skill 引导、dashboard、bundle/preset、多机同步。

---

## 2. `openskills`（numman-ali）——主张属实，但已 7 个月未更新

信源：仓库 README（github.com/numman-ali/openskills）+ GitHub REST API。

| 旧文档主张 | 验证结果 | 说明 |
|---|---|---|
| ~10.7K★ | ✅ | API 实测 10,754★（671 forks） |
| v1.0.0 首发 2025-10，v1.5.0 加 update | ⚠ | API 显示仓库 created 2025-10-26，共 **47 commits**，最后 push **2026-01-18**——项目实质停更约 8 个月（旧文档未记录这一点） |
| Node.js 20.6+，Apache 2.0 | ✅ / ⚠ | README 明确 Node 20.6+ 与 Apache 2.0；但 GitHub API license 检出 NOASSERTION（LICENSE 文件非标准模板文本） |
| 「把 Anthropic SKILL.md 协议 100% 搬到所有 agent」 | ✅ | README："Exact Claude Code compatibility — same prompt format, same marketplace, same folder structure"；生成与 Claude Code 相同的 `<available_skills>` XML 块写入 AGENTS.md |
| CLI 代替 MCP 论证 | ✅ | FAQ 原文："MCP is for dynamic tools. Skills are static instructions + resources... no server required" |
| 命令 install/sync/list/read/update/manage/remove | ✅ | 全部在 README 命令清单中；update 支持逗号分隔多 skill |
| 路径选项（`--global`/`--universal` → `.agent/skills`） | ✅ | 注意是**单数 `.agent/skills`**（与 `.agents/skills` 共享目录约定不同——一个潜在的路径碎片化点）；universal 模式加载优先级：`./.agent/` > `~/.agent/` > `./.claude/` > `~/.claude/` |
| update 只对带 source metadata 的 skill 生效 | ✅ | README："If a skill was installed before updates were tracked, re-install it once to record its source" |

**深挖补充**：README 侧栏对照表明确「Marketplace: Anthropic marketplace / GitHub (anthropics/skills)」；源类型覆盖 GitHub 仓库 / 本地路径 / 私有 git repo（SSH URL）。无 lockfile（metadata 随 skill 目录走）。

**判断修正**：从「协议共生、成熟度尚浅」改为「**协议共生但项目实质停更**」——它验证了协议路线，但不再是需要盯防的活体竞品；其「AGENTS.md + `<available_skills>` XML」机制被任何 agent 读取的设计仍值得借鉴。

---

## 3. `asm`（luongnv89/asm）——被旧文档严重低估的「上下文成本管理」差异化

信源：仓库 README 全文（46KB）+ GitHub REST API。

| 旧文档主张 | 验证结果 | 说明 |
|---|---|---|
| Node CLI，覆盖 15+ agent | ❌ **低估** | README："**21 providers** (Agents, Claude Code, Pi, OpenCode, Codex, …)"——"Claude Code, Codex, Cursor, and 18 more" |
| Bundle 概念（`asm bundle install frontend-dev`） | ✅ | 且有在线目录页 luongnv.com/asm/#/skills（"Browse 6,000+ skills"） |
| Audit / security 子命令 | ✅ 且更丰富 | `asm audit --yes`（去重）、`asm audit overlap`（**语义重叠检测**：不同名但同职能的 skill）、`asm audit residency`（常驻上下文排名 + 降级建议）、`asm audit security`（装前扫描 shell exec / network access / credential exposure；报告不阻断） |
| 私有仓库走 SSH | ⚠ | README 全文未见 SSH/私有仓库表述，未能验证 |
| （未记录）体量 | — | API 实测 **930★**，MIT，TypeScript，created 2026-03-11，最后 push 2026-09-13（活跃） |

### 3.1 深挖新发现（对我们最有参考价值）

1. **Attention budget（`asm stats --tokens`）**：把每个已装 skill 的成本拆成「常驻（frontmatter description，每条消息都付）」vs「body（触发时才付）」，按工具/scope 汇总，列出最贵 description 清单和 resident token 中位数。**这是全赛道唯一把「skill 管理的问题定义成上下文预算管理」的工具**——对我们 hub 模型天然适配（hub 里的 skill 未分发 = 零常驻，distribute = 付常驻成本，这正是我们模型的最佳卖点，但我们没把这个账算给用户看）。
2. **Residency audit + 降级阶梯**：installed（常驻）→ saved（`asm install --library` 存库不挂载，`asm deactivate` 摘掉 symlink）→ disabled（改名 SKILL.md）→ reference（`asm get` 零留存）。**降级只报告不执行**，建议命令按安装方式匹配。
3. **`asm get` 引用层**：把 SKILL.md body 打到 stdout（`asm get code-review | your-agent --system-prompt-file -`），`--path` 可借用完整目录（`asm cleanup` 归还）；名字解析走四级阶梯（installed → library → index → registry）并报告命中的 tier（**provenance 可见性**）；远端解析走浅克隆临时目录 + **与 install 相同的装前安全扫描**。
4. **库模式**：`asm install --library` 装一次进本地库，`asm activate` 按 provider 挂 symlink——**这就是「hub + 按需分发」的雏形**（与我们模型的最近邻）。
5. **npm 包名是 `agent-skill-manager`**——与 jroslaniec 的仓库名 `agent-skill-manager` 撞名（见下节），搜索时极易混淆。
6. **面向 agent 的 CLI 设计**：全命令 `--json` / `--yes` / `--machine`；「AI agent / script → asm command --json → 解析决策」的架构图——与我们的 manager-skill-first 是同一命题（agent 可驱动）的不同解法（他们靠输出协议，我们靠专用 manager skill）。
7. 其他：本地 tag 系统、`asm init/link/eval/publish`（自建 ASM registry + skill 评测）、安装 shorthand `github:owner/repo[#ref][:path]`、registry commit pin、Node 22+、无遥测无账号。

---

## 4. `sm` / agent-skill-manager（jroslaniec，Rust）——主张属实，但体量仅 1★

信源：仓库 README + GitHub REST API。

| 旧文档主张 | 验证结果 | 说明 |
|---|---|---|
| Rust 单二进制，`curl … | sh` 安装 | ✅ | installer.sh 从 GitHub Releases 下载；`sm self upgrade [--check|--force]` 自升级；每日一次新版本检查（`SM_NO_UPDATE_CHECK=1` 关闭） |
| symlink + 缓存仓库 | ✅ | 「clones repositories containing skills to a local cache directory. When you enable a skill, it creates symlinks in all your registered coding agents' skill directories」；本地路径不 clone、symlink 直连源目录（改即生效） |
| 交互 TUI | ✅ | bare `sm` 进入交互模式，管理所有仓库的 skills + subagents |
| `repo auto-upgrade` | ✅ 且更细 | `sm repo auto-upgrade on/off <repo>` 标记自有仓库；每日后台维护 pass 自动 pull（跳过 pinned）；`SM_NO_AUTO_UPGRADE=1` 全局关闭；`sm repo list` 显示 AUTO-UPGRADE 列 |
| （未记录）体量 | — | API 实测 **1★**，created 2026-01-06，最后 push 2026-06-14；license 未检出 ⚠ |

**深挖补充**：agent 覆盖比想象更窄——内置 integration 只有 2 个：`claude-code` → `~/.claude/skills` 和 `agents` → `~/.agents/skills`（**Codex/Gemini CLI/OpenCode 全部归并到共享 agents 目录**；旧版本独立 integration 自动迁移）；更多 agent 靠 `sm integrations add <name> --path` 自定义。另有：subagent 管理（AGENT.md 发现）、repo pin/unpin 到 commit SHA、`sm upgrade` 升级全部未 pin 仓库、Windows 不支持（Unix symlink）。「性能与分发形态占优但功能窄」的旧判断 ✅ 维持，但需加上「社区体量几乎为零」。

---

## 5. `skm-cli`（PyPI）——声明式主张属实，且链接策略比我们精细

信源：PyPI JSON API（版本/日期/全文 description）+ pip index。

| 旧文档主张 | 验证结果 | 说明 |
|---|---|---|
| Python，YAML 声明式 `~/.config/skm/skills.yaml` | ✅ | 作者 Reorx（novoreorx@gmail.com），仓库 **github.com/reorx/skm**；requires Python ≥3.12；最新 0.2.2（2026-07-12），首发 0.1.0（2026-03-17） |
| 幂等 sync + `skills-lock.yaml` | ✅ | 「treats skills.yaml as a declarative state file」；**只动 lock 追踪的链接**，其他工具装的 skill 永不触碰（很好的安全边界） |
| 「声明式 vs 命令式路线之争」 | ⚠ 需细化 | skm 同时支持命令式：`skm install <repo-url> [skill]` 直接装并**自动写回 skills.yaml**——两种范式它都要 |

**深挖新发现**：

1. **克隆策略比 npx skills 更激进**：默认 `git clone --filter=blob:none`（blob 部分克隆），可选 `clone_strategy: shallow` 加 `--depth 1`；缓存仓库复用 + pull。这是赛道里唯一默认用 partial clone 的。
2. **四级链接策略**（对我们 copy/symlink 双模式的直接竞品）：symlink（默认）→ `use_hardlink: true` 时同盘 hardlink → 跨盘尝试 **reflink/COW**（Linux `FICLONE` ioctl / macOS `clonefile(2)`，实现隔离在 `src/skm/clonefile.py`）→ 退化 plain copy。按「同 inode 共享 / 写时复制 / 全量拷贝」逐级降级。
3. agent 覆盖仅 **4 个**：`standard`（`~/.agents/skills/`）、`claude`、`codex`、`openclaw`。
4. 明确只管 **user 级**（`~/.claude/skills/` 等），不做 project scope。
5. 包级配置粒度：`skills` / `skills_excludes`（互斥）、`skills_dir`（限定扫描目录）、按 package 的 agents includes/excludes。
6. skill 发现顺序：根 SKILL.md（单例）→ `./skills/` → 全目录树 → 找到即停止（不嵌套）。

---

## 6. `xingkongliang/skills-manager`（桌面版）——旧判断「不是真对手」必须推翻

信源：仓库 README（英文版全文关键段）+ GitHub REST API + 官网 skillsmanager.dev。

| 旧文档主张 | 验证结果 | 说明 |
|---|---|---|
| 名字撞车的桌面版 | ✅ | desktop app（macOS `brew install --cask skills-manager`、.dmg；Windows .exe/.msi；Linux .AppImage/.deb/.rpm）；GitHub 语言主栏是 **Rust**——形态更像 Tauri 系而非 Electron（README 未自述框架，Electron 之说 ⚠ 未能验证） |
| ~3.8K★ | ⚠ 已过期 | API 实测 **4,743★**（created 2026-03-02，最后 push 2026-09-15 当天——非常活跃），带 Trendshift 徽章 |
| 覆盖 15+ coding tools | ❌ **低估** | README："**54 agents are supported out of the box**"（Claude Code、Codex、Cursor、GitHub Copilot、Gemini CLI、GitLab Duo、OpenCode、OpenClaw、OpenHands、Cline、Goose、Windsurf、Continue、Grok、Antigravity、Qwen Code、Crush、Kilo Code、Roo Code、Amp、Kiro CLI、Droid、TRA…） |
| 是否开源 | ✅ | MIT，GitHub 公开仓库 |

### 6.1 深挖：与我们模型的同构程度惊人

| 能力 | xingkongliang/skills-manager | skills-manager（我们） |
|---|---|---|
| 集中库路径 | **默认 `~/.skills-manager`（路径完全撞车）**，Settings 可改 | `~/.skills-manager` |
| 分发模式 | symlink 或 copy 双模式一键 sync | copy / symlink 双模式（ADR-0003） |
| 源类型 | Git repo、本地目录、`.zip` / `.skill` 归档、**skills.sh marketplace** | git / url / archive / marketplace / well-known |
| agent 驱动管理 | **manage-skills skill**：「Claude Code, Codex, Cursor 可以装 skill、部署到另一个 agent、报告现状——通过驱动 Skills Manager 而不是背着它写 agent 目录」；Dashboard 一键把该 skill 部署到所选 agent | manager-skill-first（ADR-0014） |
| Bundle / 场景化 | **Presets**：命名技能组，preset pill 一键启停 | 暂无（候选） |
| 多机同步 | **Backup & Multi-Device Sync**：私有 GitHub repo（8 位设备码登录，token 存 OS keychain）+ **skill 级合并**（改名+编辑可合）+ 冲突不阻塞（keep mine / use remote / keep both）+ 快照可恢复；>100MB skill 自动排除 | sync 已记候选，未实现 |
| 内嵌 CLI | 「Every installer ships the CLI inside the app」；且本身发布为 skill：`npx skills add xingkongliang/skills-manager` | CLI-first |
| 其他 | tags/筛选（含 Untagged）、批量操作、Linked Workspaces（任意目录当 skills root）、活动日志 + 导出、应用内自更新 | dashboard、provenance backfill、tree-SHA 锚点、stale 检测回滚（它未明示这些） |

**判断修正**：从「不是真对手，但要在命名/SEO 抢话语权」改为「**正面撞车的对手**——hub+distribute+manager skill+dashboard 四件套它都有（形态是桌面 GUI），且 hub 默认路径与我们就相同」。我们仍独有：CLI-first（可脚本化/CI）、url/well-known 源、tree-SHA 更新锚点（它的 update tracking 只说 "Git-based skills"，粒度未明 ⚠）、provenance backfill 三层、stale 检测 + 回滚、npm 包身份。SEO 区分从「建议」升级为「紧急」。

---

## 7. `skills.sh`（registry）——search API 已验证，注册模型仍半黑盒

信源：skills.sh 站点 + `/api/search` 实测 + npx-skills-download-strategy.md（既有结论）。

- **是什么**：Next.js 应用，第三方（Vercel 系）skills 注册中心；**与 vercel-labs/skills 的关系已由源码级调研坐实**——`npx skills` 的 blob 快速路径直接调 `https://skills.sh/api/download/{owner}/{repo}/{slug}` 拿服务端预建快照，搜索走 `https://skills.sh/api/search`（`docs/research/npx-skills-download-strategy.md` §2.2）。
- **search API 实测 ✅**：`GET /api/search?q=pdf` 返回 `{query, searchType: "fuzzy", searchVersion: "legacy", skills: [{id, skillId, name, installs, source}]}`——含**安装量计数**（anthropics/skills/pdf 196,222 installs、openai/skills/pdf 12,425、github/awesome-copilot/pdftk-server 10,034）。
- **注册模型 ⚠**：未见公开的「提交/发布 API」文档；从证据看索引自动来自 GitHub 仓库爬取/收录（skill 条目 `source` 均为 `owner/repo`）。给仓库挂 badge（`skills.sh/xingkongliang/skills-manager`）是官方认可路径。
- **下载端点**：直接裸调 `/api/download/...` 返回 error（需正确参数或仅供 CLI 内部使用）⚠。
- **对旧文档的确认**：「已被我们列入候选方向（接 skills.sh）」维持；另外它现在还是 xingkongliang 的 marketplace 源——**我们若接入 skills.sh，等于与桌面对手共享同一上游**。

---

## 8. `obra/superpowers`——纯内容+方法论判断维持，无分发 CLI

信源：仓库 README + GitHub REST API。

| 核对项 | 验证结果 | 说明 |
|---|---|---|
| ~257K★ | ⚠ 已过期 | API 实测 **286,974★**（Shell 为主语言，MIT，2026-09-14 仍活跃） |
| 是否有分发/安装机制 | ✅ 有，但**不是 CLI** | 分发走**各 harness 的官方 plugin marketplace**：Claude 官方 marketplace（claude.com/plugins/superpowers）、Codex 官方 plugin marketplace（openai/plugins，`/plugins` 搜索安装）、Cursor（`/add-plugin superpowers`）；Devin/Factory Droid 等从仓库装 plugin |
| 跨 agent 一键分发 | ❌ 没有 | README 原文："If you use more than one, install Superpowers **separately for each one**" |
| 覆盖面 | ✅ 广但逐装 | 安装目标 14 个 harness（Claude Code、Antigravity、Codex App/CLI、Cursor、Devin CLI、Factory Droid、Gemini CLI、GitHub Copilot CLI、Grok Build CLI、Kimi Code、OpenCode、Pi、Hermes Agent） |
| 商业化 | 新发现 | Prime Radiant 公司（Jesse Vincent/obra）提供 enterprise 商业支持（sales@primeradiant.com）+ Discord 社区 + 邮件列表发版通知 |

「结构性威胁来自它补齐跨 agent 分发」的旧判断 ✅ 维持——它目前在「每 harness 一个 plugin」的分发粒度上，没有 hub/CLI 形态。

---

## 9. 新发现竞品（旧文档未收录）

来源：npm registry search（`agent skills manager`，2026-09-15）+ GitHub API 交叉验证。2026-08/09 是新品密集窗口，赛道正在变拥挤。

| 项目 | 包 / 仓库 | 体量 | 一句话定位 | 信源 |
|---|---|---|---|---|
| **rosie-skills**（withastro/rosie） | npm `rosie-skills` / brew | 156★ | **Astro 团队出品**：「npm, but for skills」——`rosie install anthropics/skills`；有**lockfile 格式 + typed JavaScript API** 的正式文档（rosieskills.dev）；跨平台（npm + Homebrew + apt/AUR 计划） | [github.com/withastro/rosie](https://github.com/withastro/rosie) / [rosieskills.dev](https://rosieskills.dev/) |
| **skl**（loopdoop/skl） | 单二进制（useskl.com） | 0★（仓库仅放 release + issues，**闭源**） | 「Self-hosted, cross-harness skill distribution」：发布一次、跨 harness 安装、**在另一台机器精确重建同一套 setup**（多机复现）；curl 安装单原生二进制 | [github.com/loopdoop/skl](https://github.com/loopdoop/skl) / [useskl.com](https://useskl.com) |
| **skillfish**（knoxgraeme/skillfish） | npm `skillfish` | 317★ | "All in one Skill manager… Install, update, and sync Skills across Claude…"（最后 push 2026-08-07） | [github.com/knoxgraeme/skillfish](https://github.com/knoxgraeme/skillfish) |
| **TanStack/intent** | npm `@tanstack/intent` | 331★ | **生态层而非 manager**：给**库维护者**随 npm 包生成/校验/分发 Agent Skills（auto-discovered、随代码版本化）——这才是「skills 随 npm 包分发」路线的真实代表 | [github.com/TanStack/intent](https://github.com/TanStack/intent) |
| **skillcoffer**（Howryann/skillcoffer，中文项目） | npm `skillcoffer`（短命令 `skco`） | 3★ | 本地版本化工作流：`save`/`restore` 不可变存档、`check`/`diff` 审查上游再 `update --apply`（**ref 解析记录为 commit SHA**）、live/pin 双挂载、bundle 生成 `pi --skill` 命令、localhost WebUI | [github.com/Howryann/skillcoffer](https://github.com/Howryann/skillcoffer) |
| **skls-mgr**（Xaviw/skills-manager） | npm `skls-mgr` | 5★ | 集中式目录 `~/.config/skls-mgr` + 按需 symlink 到任意 tool 目录；明确对位 npx skills 的「重复 add」痛点；**skills.sh 命令直接替换兼容**（`skills add` → `skls-mgr add`） | [github.com/Xaviw/skills-manager](https://github.com/Xaviw/skills-manager) |
| 其他长尾 | embedskills、@igorkosta/asm（撞名）、agent-skills-manager（DaniAkash，wraps vercel-labs）、skilio、@michengai/dsh-skills-manager、@antseer_dev/skillhub-cli | — | 均为早期/垂域小项目，暂不构成威胁 | npm search |

**另两项旧条目的核实**：`iyangdianfeng/skill-manager`（旧文档 1.7）实测 **0★**、AGPL、2026-01 后停更——建议从对标清单降权为脚注；`antfu/skills` 见下节修正。

---

## 10. 体量数据全面复核（2026-09-15，GitHub REST API / shields.io）

| 项目 | 旧文档数字 | 实测 | 偏差 |
|---|---|---|---|
| vercel-labs/skills | ~26K★ | **31,686★**（npm `skills` 1.5.26，2026-09-11） | 旧 |
| gh skill | —（新） | CLI 内置，无独立 star | — |
| obra/superpowers | ~257K★ | **286,974★** | 旧 |
| antfu/skills | ~78K★ | **5,884★** | ❌ 严重失实 |
| xingkongliang/skills-manager | ~3.8K★ | **4,743★** | 旧 |
| openskills | ~10.7K★ | 10,754★ ✅（但 2026-01-18 起停更） | ✅ |
| phuryn/pm-skills | ~22K★ | 26,338★ | 旧 |
| NVIDIA/SkillSpector | ~14K★ | 17,274★ | 旧 |
| asm（luongnv89） | 未记 | **930★** | — |
| jroslaniec/agent-skill-manager | 未记 | **1★** | — |
| TanStack/intent | 未收录 | 331★ | 新 |
| skillfish | 未收录 | 317★ | 新 |
| withastro/rosie | 未收录 | 156★ | 新 |

**antfu/skills 修正**：README 实为一句话定性——「**Anthony Fu's curated collection of Agent Skills**…proof-of-concept project for generating agent skills from source documentation and keeping them in sync」，安装方式就是 `pnpx skills add antfu/skills`（**依赖 vercel-labs/skills CLI**）。旧文档给它的「Skills Npm / skills 当 npm 包发 / ~78K★」三个标签全部错误；该路线的真实代表是 **TanStack/intent**（331★）。

---

## 11. 对 skills-manager 的启示

### 11.1 必须修正 `competitors-2026-09.md` 的条目

1. §1.2 gh skill「覆盖 agent 5+」→ **48 个**（官方 manual 列表）；补记 `--from-local`、`.agents/skills` 共享目录、`--upstream`、`--unpin`、update provenance 询问、publish 的 immutable releases / secret scanning 检查。
2. §1.3 openskills 补记「2026-01-18 起实质停更」。
3. §1.4 asm「15+ agent」→ **21 providers**；npm 包名 `agent-skill-manager`（与 jroslaniec 仓库名撞车）；补 attention budget / residency audit / `asm get` 引用层 / library 模式。
4. §1.5 sm 补记「仅 1★、最后 push 2026-06-14、内置 integration 仅 2 个（其余靠 --path 自定义）」。
5. §1.9 / §5.5 xingkongliang：**从「名字噪音」升级为「正面撞车对手」**——hub 默认路径同为 `~/.skills-manager`、54 agents、presets、manage-skills skill、git backup 多机同步（skill 级合并 + 快照）。SEO 区分升级为紧急事项。
6. §2 表格：antfu/skills 行重写（个人集合 PoC，5.9K★，依赖 npx skills）；「skills 随 npm 包发」帽子转给 TanStack/intent。
7. §1.7 iyangdianfeng/skill-manager 降权（0★、停更）。
8. 第 4 节对比表 agent 覆盖列：gh skill 48、openskills 5、asm 21、skm 4、xingkongliang 54。

### 11.2 竞品已有、我们缺失的能力（按优先级）

1. **上下文成本可视化（asm 独有，与我们模型最契合）**：`stats --tokens`（常驻 vs body）+ residency audit。hub 的本质优势就是「未分发 = 零常驻」，应把这个账算给用户看——dashboard 的 doctor 信号天然可以承载。
2. **多机同步 / hub git 化**：xingkongliang 已做完整版（设备码 + keychain + skill 级合并 + 快照），skl 以「机器间精确重建」为卖点。我们的 `sync` 候选方向从「值得做」升级为「被两面夹击，须尽快做」。
3. **Bundle / Preset**：asm bundles + xingkongliang presets 双重验证了需求；我们已有 categories apply，preset 是其自然延伸。
4. **装前安全扫描**：asm（shell exec / network / credentials，报告式）+ gh skill publish（secret/code scanning + immutable releases）+ SkillSpector（独立扫描器）。建议按旧文档 5.4 的思路在 install/update 挂第三方扫描 hook。
5. **引用层（`asm get` 式零留存取用）**：hub 天然适合——「hub 里的 skill 不分发也能被 agent 一次性读取」。这是 manager skill 可以直接暴露的能力，成本低、差异化明显。
6. **create/publish 链路**：gh skill publish（GitHub 绑定）与 asm publish（自建 registry）各占一头；我们候选中的 create/push 应瞄准「任意 git host + well-known index」的通用位。

### 11.3 锚点与互操作（机会窗口）

- **frontmatter 便携 provenance 正在成为事实标准**：gh skill 把 repository/ref/tree SHA 写进 SKILL.md frontmatter 并以「provenance travels with the skill」为卖点；npx skills 用独立 `.skill-lock.json`。我们的 tree-SHA 锚点（ADR-0013/0016）若也落 frontmatter，即可与 gh skill 装出的 skill **互认更新**（gh skill update 甚至会读别的工具装的 skill 并交互补源）——互操作从「避免被标准封死」变成「借 GitHub 渠道获客」。
- **`.agents/skills` 共享目录被三方共同采纳**（gh skill project scope、sm 的 agents integration、skm 的 standard）——我们 catalog 里对应 agent 的 distribute 目标路径应确保与该约定一致。
- **skills.sh 是双刃上游**：接入即获得安装量数据（search API 的 installs 字段）与发现层，但也与 xingkongliang 共享同一 marketplace 源；接入时应同步做我们自己的 find 差异化（provenance backfill 的 search 层已是我们独有）。

### 11.4 竞争格局再校准

- 第一梯队威胁排序更新：**gh skill（48 agents + GitHub 渠道）> xingkongliang（模型同构 + 4.7K★ + 桌面形态）> npx skills（31.7K★，协议共生）**。
- openskills 停更、sm 微体量、skm/skillcoffer/skls-mgr 各占一个细分（声明式 / 版本化审查 / 集中 symlink），均不构成正面威胁，但**每个细分都证明了对应需求真实存在**。
- 新变量：withastro/rosie（Astro 团队 + lockfile + typed API 的工程化打法）与 loopdoop/skl（闭源二进制 + 多机复现）——建议列入 §6 跟踪节奏的月度扫描清单。

---

## 引用源（全部一手信源，2026-09-15 抓取）

- gh skill 官方 manual：[gh skill](https://cli.github.com/manual/gh_skill) / [install](https://cli.github.com/manual/gh_skill_install) / [update](https://cli.github.com/manual/gh_skill_update) / [publish](https://cli.github.com/manual/gh_skill_publish) / [preview](https://cli.github.com/manual/gh_skill_preview) / [list](https://cli.github.com/manual/gh_skill_list) / [search](https://cli.github.com/manual/gh_skill_search)
- GitHub Blog：[Manage agent skills with GitHub CLI（2026-04-16）](https://github.blog/changelog/2026-04-16-manage-agent-skills-with-github-cli/)
- 仓库 README：[numman-ali/openskills](https://github.com/numman-ali/openskills) / [luongnv89/asm](https://github.com/luongnv89/asm)（46KB 全文）/ [jroslaniec/agent-skill-manager](https://github.com/jroslaniec/agent-skill-manager) / [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager) / [obra/superpowers](https://github.com/obra/superpowers) / [withastro/rosie](https://github.com/withastro/rosie) / [loopdoop/skl](https://github.com/loopdoop/skl) / [Howryann/skillcoffer](https://github.com/Howryann/skillcoffer) / [Xaviw/skills-manager](https://github.com/Xaviw/skills-manager) / [TanStack/intent](https://github.com/TanStack/intent) / [antfu/skills](https://github.com/antfu/skills)
- PyPI JSON API：[pypi.org/pypi/skm-cli/json](https://pypi.org/pypi/skm-cli/json)（作者 Reorx，仓库 [reorx/skm](https://github.com/reorx/skm)）
- npm registry search：[registry.npmjs.org/-/v1/search?text=agent skills manager](https://registry.npmjs.org/-/v1/search?text=agent%20skills%20manager)
- skills.sh：[站点](https://skills.sh/) / [api/search?q=pdf 实测](https://skills.sh/api/search?q=pdf)
- 体量数据：GitHub REST API（api.github.com/repos/*）与 shields.io（2026-09-15 时点）
- 内部对照：`docs/research/competitors-2026-09.md`（被验证对象）、`docs/research/npx-skills-download-strategy.md`（skills.sh 与 blob 路径的既有源码级结论）
