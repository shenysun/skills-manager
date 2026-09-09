# `npx skills` 的下载策略调研

> 调研日期：2026-09-08。
> 调研目的：为 skills-manager 的安装/更新链路优化（`--depth 1`、本地镜像缓存、`--filter=blob:none` + sparse-checkout）提供业界参照。
> 结论先行：**`npx skills` 从不克隆完整仓库历史——主路径是浅克隆（`--depth 1`），快路径是纯 HTTP 快照（仅白名单 owner），更新检测完全不用 clone（GitHub Trees API 比对目录 tree SHA）。它没有用 blob-filter/sparse-checkout，也没有本地镜像缓存。**

## 1. 包身份确认

`npx skills` 解析到 npm 包 **`skills`**：

```text
name    = skills
version = 1.5.24 (latest)   # snapshot: 1.5.23-snapshot.0
description = The open agent skills ecosystem
repository  = git+https://github.com/vercel-labs/skills.git
maintainers  = rauchg <rauchg@gmail.com>（Vercel CEO Guillermo Rauch）, quuu
```

（来源：`npm view skills` 输出，2026-09-08。用户机器 npx 缓存中还有 1.5.19 版副本。）

本文引用的源码来自仓库 `vercel-labs/skills`，commit `1682051d48c34f5eb135e6475c1a965dce05e820`（2026-09-06）。下文行号均指该 commit 下的 `src/` 文件。

## 2. 三条下载路径（按源类型分发）

CLI 入口 `src/add.ts`（`skills add`）和 `src/use.ts` 按解析出的源类型走不同路径（add.ts:1156-1231，use.ts:260-295）：

| 源类型 | 路径 | 是否用 git |
|---|---|---|
| 本地路径 | 直接遍历发现 | 否 |
| `well-known` / 直接下载 URL | HTTP 下载（SKILL.md 单文件或 zip/tar 归档） | 否 |
| GitHub（白名单 owner） | blob 快照快速路径 | 否（纯 HTTP） |
| GitHub（其余）/ GitLab / 任意 git URL / `--full-depth` | **`git clone --depth 1`** | 是 |

### 2.1 HTTP 直接下载（`src/download-source.ts`）

`downloadSource()`（download-source.ts:259-291）：

- `fetch` 该 URL，30 秒超时（download-source.ts:13, 85-88）。
- 先判断是不是单个 `SKILL.md`（frontmatter 含 `name` + `description` 即算，download-source.ts:124-132, 273-278）。
- 否则按魔数识别 zip（`PK`）/ gzip / tar 并解压（download-source.ts:224-240）。
- 限额：下载 10MB、解压后 25MB、最多 1000 个文件；可用 `SKILLS_DOWNLOAD_MAX_BYTES` / `SKILLS_EXTRACT_MAX_BYTES` / `SKILLS_EXTRACT_MAX_FILES` 环境变量覆盖（download-source.ts:10-12, 39-48）。
- zip-slip 防护：路径规范化 + `..` 段拒绝 + 目标必须落在解压目录内（download-source.ts:50-62, 183-191）。

### 2.2 blob 快照快速路径（`src/blob.ts`）——仅限白名单 owner

这是最有意思的一条：**对白名单仓库完全绕开 git，用三个 HTTP 服务拼出安装**。

触发条件（add.ts:1182-1191；use.ts:80, 269-272）：

- GitHub 源、未指定 `--full-depth`，且
- owner 属于 `BLOB_ALLOWED_OWNERS = ['vercel', 'vercel-labs', 'heygen-com']`，或 repo 为 `zapier/connectors`（自托管下载端点，blob.ts:51-56）。
- 指定了显式 ref 时直接跳过此路径（快照按 owner/repo/slug 键控，不绑 ref，见 blob.ts:522-527 注释）。

流程（blob.ts 文件头注释 1-11；`tryBlobInstall` 513-659）：

1. **GitHub Trees API**：`GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1` 拿整棵文件树（`fetchRepoTree`，blob.ts:235-275；分支尝试顺序 `HEAD → main → master`，blob.ts:240）。
2. **树内发现 SKILL.md**（`findSkillMdPaths`，blob.ts:347-432）：优先扫描 30+ 个约定目录（`skills/`、`.claude/skills/`、`.codex/skills/` 等，`PRIORITY_PREFIXES`，blob.ts:306-340），最多向下 3 层；否则退回全树 5 层深度。
3. **并行**从 `raw.githubusercontent.com` 拉每个 SKILL.md，读 frontmatter 拿 name/description（`fetchSkillMdContent`，blob.ts:440-455；`Promise.all` 并行，blob.ts:553-559）。
4. **并行**从 skills.sh 下载 API 拉整个 skill 的文件快照：`https://skills.sh/api/download/{owner}/{repo}/{slug}`（`fetchSkillDownload`，blob.ts:461-479），返回 `{files, hash}`。
5. 任何一步失败或任一 skill 快照拉不到 → 返回 `null`，调用方回退 git clone（blob.ts:619-621 注释"we don't do partial blob installs"）。

也就是说：**快路径的"缓存"在 skills.sh 服务端**（他们预建了这些仓库的 skill 快照），客户端不做任何缓存。根目录级 skill 只保留 SKILL.md 本身，防止把整个仓库倾倒进 skills 目录（blob.ts:633-641 注释）。

GitHub API 鉴权与限流（blob.ts:97, 235-275）：

- 默认匿名调用（60 req/hr/IP）。
- 403 且 `X-RateLimit-Remaining: 0` → 进程内 memo `_rateLimitedThisSession`，后续调用跳过匿名直走鉴权（blob.ts:97-102, 244-246, 270-272）。
- 401/404（私有仓库对匿名请求的表现）→ 依次尝试 `GITHUB_TOKEN` / `GH_TOKEN` 环境变量（skill-lock.ts:129-143），再试 `gh api`（借 GitHub CLI 登录态，不导出凭证；blob.ts:172-207）。
- GHE 支持：`GH_HOST` 指定企业主机后 API 走 `https://{host}/api/v3`（github-host.ts；blob.ts:116-118）。

### 2.3 git 浅克隆回退（`src/git.ts` `cloneRepo`）——大多数仓库实际走的路径

`cloneRepo(url, ref?)`（git.ts:295-384）：

- **`git clone --depth 1 [--branch <ref>]`**（git.ts:301，simple-git 库）。浅克隆 = 默认分支当前快照的全部文件，不带历史。
- **没有** `--filter=blob:none`、**没有** sparse-checkout、**没有** tarball API 下载。他们的取舍：浅克隆足够小且简单可靠，不需要部分克隆的复杂度。
- **LFS 跳过**：`GIT_LFS_SKIP_SMUDGE=1` + `filter.lfs.*` 全部置空（git.ts:180-185, 219-227）——没装 git-lfs 时 checkout 会炸（注释引 heygen-com/hyperframes#407），装了也别拉 LFS 大文件（skill 都是纯文本）。
- **协议白名单**：`GIT_ALLOW_PROTOCOL=https:http:ssh:git:file`，并显式拒绝 `ext::` 传输（git.ts:10, 295-298），防 git transport 注入。
- **超时**：5 分钟（`SKILLS_CLONE_TIMEOUT_MS` 可调，git.ts:9-16）；超时报错文案引导用户调大超时或手动 clone 后传本地路径（git.ts:328-342）。
- **认证回退链**（git.ts:305-374）：HTTPS 直接 clone → 失败且判定为认证错误且是 GitHub HTTPS URL 时，先试 `gh repo clone`（会读 `gh auth status` 的 git 协议偏好决定 https/ssh，git.ts:237-264）→ 再试 SSH URL（`ssh -o BatchMode=yes`，git.ts:354-370）→ 最终给出含 `gh auth status` / `ssh -T` 排查步骤的报错（git.ts:266-293）。SAML SSO 场景有专门文案（git.ts:268-275）。
- **commit SHA ref 的特殊处理**（git.ts:30-32, 65-77, 311-323）：`--branch` 不接受裸 SHA → 回退为 `git init` + `git fetch --depth 1 origin <sha>` + `checkout FETCH_HEAD`（`cloneAtSha`），依赖服务端 `uploadpack.allowReachableSHA1InWant`（GitHub/GitLab 均开启）。
- 临时目录 `mkdtemp(tmpdir()/skills-*)`（git.ts:300），用完 `cleanupTempDir` 删除，删除前校验路径确实在系统 tmpdir 内（git.ts:420-430）。

### 2.4 非 GitHub 源

- **GitLab / 任意 git URL**：一律走 2.3 的 clone（add.ts:1220-1223 注释 "GitLab, git URL, or --full-depth: always clone"）。source-parser.ts 支持 gitlab 子分组与 `/-/tree/<ref>/<subpath>` URL（source-parser.ts:387-421）。
- **well-known（RFC 8615）**：任意网站在 `/.well-known/agent-skills/index.json`（旧路径 `/.well-known/skills/`）发布 skill 索引，CLI 纯 HTTP 拉取（providers/wellknown.ts:115-135, 170-219）；v0.2.0 为单工件 + digest 模型。
- **本地路径**：直接发现，不 clone（add.ts:1156-1170）。
- **skills.sh 注册表**：搜索走 `https://skills.sh/api/search`（find.ts:91）。

## 3. 更新检测：不用 clone

锁文件 `.skill-lock.json`（全局在 `~/.agents/.skill-lock.json` 或 `$XDG_STATE_HOME/skills/`，skill-lock.ts:64-81），schema v3。每条记录含 `skillFolderHash`：

> "GitHub tree SHA for the entire skill folder. This hash changes when ANY file in the skill folder changes."（skill-lock.ts:24-29）

即锚点是 **skill 子目录的 git tree SHA，不是仓库 commit SHA**——上游动了仓库其他部分不会误报更新。

`skills update` 流程（update.ts:561-652）：

1. GitHub 源：`fetchRepoTree` 拿当前树 → `getSkillFolderHashFromTree`（blob.ts:281-301）取最新目录 tree SHA → 与锁文件比对。**无变化时全程 0 次 clone、0 次大流量**，只有一次 Trees API 调用。
2. 锁定的 `skillPath` 在树里消失（skill 被上游移动/删除）→ 回退 clone 重新发现并提示（update.ts:584-601）。
3. Trees API 不可用 → 回退 `cloneRepo`（浅克隆）+ `git rev-parse HEAD:<folder>` 取 tree SHA（`getGitTreeHash`，git.ts:390-418）。
4. 非 tree-SHA 格式的旧锁 → clone 后按内容计算 folder hash（update.ts:638-641）。
5. well-known 源：比对 index.json 的 digest（update.ts:516-518, 407-435）。
6. **应用更新 = spawn 子进程重新执行 `skills add <url> --skill <name> -g -y`**（update.ts:689-733；`shell: false` 防 URL 注入，注释 717-722）——即"更新"就是重跑一遍安装路径（又一次浅克隆或 blob 拉取），没有增量 pull。

按 `source + ref` 分组检查，避免同仓库多 ref 技能互相误判（update.ts:549-559 注释）。

## 4. 缓存情况

- **无跨进程本地缓存/镜像**。每次安装、每次更新都是新建临时目录、用后即删；锁文件只存元数据（hash、时间戳、source URL/ref/skillPath），不存内容。
- 仅有的两处"缓存"：
  - skills.sh **服务端**的 blob 快照（只惠及白名单 owner）；
  - 进程内 memo（rate-limit 标志 blob.ts:97；一次 update 内复用 tree add.ts:1860-1862；agent 探测结果 detect-agent.ts:5）。

## 5. 网络韧性

- 每个 HTTP 调用都有超时：blob/API 10s（blob.ts:59）、直接下载 30s（download-source.ts:13）、clone 5min（git.ts:9）。
- **没有自动重试**——失败即降级到下一条路径（blob → clone；HTTPS → gh → SSH），用"多路径回退"替代"单路径重试"。
- 限流感知：进程内记住已限流，后续直走鉴权（blob.ts:244-246）。

## 6. 与 skills-manager 现状的对比

skills-manager 参照点：`src/infra/git-cli.ts:7-9`（`git clone` 无任何参数）、`src/core/services/source-service.ts:62-78`（每次 checkout 新建 `skills-source-<uuid>/repo` 临时目录、`rev-parse HEAD` 记 commit）、`src/core/services/update-service.ts:67-85`（update 无条件先 clone 再安装）。

| 维度 | npx skills | skills-manager 现状 |
|---|---|---|
| clone 深度 | `--depth 1`（git.ts:301） | 完整克隆，全历史（git-cli.ts:7-9） |
| 部分克隆/sparse | 未使用 | 未使用（评估中） |
| 子目录下载 | 浅克隆整树后取子目录；快路径按 skill 打包快照 | 克隆整仓后取子目录 |
| 更新检测 | Trees API 比对 skill 目录 tree SHA，无变化 **0 次 clone**（update.ts:572-599） | 无条件 clone 后安装（update-service.ts:71） |
| 版本锚点 | skill 子目录 git tree SHA（skill-lock.ts:24-29） | 仓库 commit SHA（source-service.ts:76） |
| 跨进程缓存 | 无（服务端快照代替） | 无 |
| 超时 | 各环节均有（10s/30s/5min） | 无 |
| LFS | 显式跳过 smudge（git.ts:180-185, 224-226） | 未处理 |
| 认证回退 | HTTPS → gh CLI → SSH 三级（git.ts:305-374） | 无 |
| 临时目录 | tmpdir + 用后删 + 删除前路径校验（git.ts:420-430） | tmpdir（删除情况待查） |

## 7. 对 skills-manager 改进选项的直接启示

1. **`--depth 1` 应立即采纳**：这是 npx skills 与我们现状最大的单点差距，零功能损失（skill 安装从不需要历史），改动一行参数。若支持指定 ref，配套 `--branch <ref>`；若允许锁 commit SHA，需准备 `init + fetch --depth 1 origin <sha>` 的回退（`--branch` 不接受裸 SHA，git.ts:65-77 有现成实现可参考）。
2. **`--filter=blob:none` + sparse-checkout 不是业界选择**：npx skills 明确没走这条路。浅克隆已把成本压到"当前快照"级别；部分克隆引入 git 版本兼容与协议复杂度，收益边际。若要更省，他们的答案是**绕开 git 用 HTTP**（见下条），而非更精细的 clone。
3. **更新检测去 clone 化是比克隆优化更大的收益**：GitHub 源先打一次 Trees API（`?recursive=1`），比对 skill 子目录 tree SHA，无变化直接返回。这一步让 `update` 从"每个源一次完整 clone"变成"每个源一次轻量 API 调用"。配合把锁文件的版本锚从 repo commit SHA 迁到 skill 目录 tree SHA，还能消除上游无关 commit 造成的误报。注意 Trees API 匿限额 60 req/hr/IP，需照抄他们的限流感知 + token/gh 鉴权回退（blob.ts:235-275）。
4. **本地镜像缓存是超出 npx skills 的自选动作**：他们用"服务端快照 + 浅克隆"的组合证明了可以不做本地缓存。skills-manager 若加本地 mirror（如 `~/.skills-manager/cache/<repo>` + fetch 增量），需自行承担失效与磁盘治理成本——npx skills 的经验没有为这条路背书，但也没否定。
5. **可抄的工程细节**：`GIT_LFS_SKIP_SMUDGE=1`（防无 git-lfs 环境 checkout 失败）、clone 超时 + 可调环境变量、`GIT_ALLOW_PROTOCOL` 白名单、临时目录删除前的路径校验、认证失败时给 `gh auth status` / `ssh -T` 排查提示——都是上游踩过坑的防御（注释里引用了具体 issue：#952、#407、#1318、#523）。

## 引用源

- npm registry：`npm view skills`（2026-09-08）
- 仓库源码：https://github.com/vercel-labs/skills，commit `1682051d`（2026-09-06），关键文件 `src/blob.ts`、`src/git.ts`、`src/download-source.ts`、`src/add.ts`、`src/use.ts`、`src/update.ts`、`src/skill-lock.ts`、`src/update-source.ts`、`src/providers/wellknown.ts`、`src/github-host.ts`
- 本机 npx 缓存副本：`~/.npm/_npx/5606f1555d02ef53/node_modules/skills/`（v1.5.19，bin 为 `bin/cli.mjs`，与仓库源一致）
