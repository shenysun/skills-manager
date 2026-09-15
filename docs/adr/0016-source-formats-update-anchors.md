# source-formats：四类新源的 registry 类型与更新锚点（收窄 ADR-0013）

source-formats 给 add 补齐四类源后，ADR-0013 的「skill 子目录 tree SHA 是唯一更新键」收窄为「**git 源的**唯一更新键」。registry source type 新增 `url` / `archive` / `marketplace` / `wellknown`，每类源各自定锚：

- **url**（URL 直下，单 SKILL.md / zip / tar）：无服务端元数据可依赖，更新检测 = 重下载 + 解包后内容 hash 比对（复用 ADR-0008 fingerprint 概念）；ETag/Last-Modified 仅作省流量预检。`upstream_tree` 留空。
- **wellknown**（agent-skills discovery 索引）：index 条目自带 `digest: "sha256:<hex>"`，存 registry 新字段 `upstream_digest`（与 `upstream_tree` 平行的 snake_case）。更新检测 = 重拉 index、逐 skill 比 digest，变了才下载 artifact 重装；安装时同样强制 digest 比对（对齐 npx skills V2，防索引与内容不一致）。`upstream_tree` 留空。
- **archive**（本地 zip 文件）：一次性快照，无更新资格，与 no-evidence import 同等待遇；`edit --source-*` 后补真源。
- **marketplace**（`.claude-plugin/marketplace.json` 清单）：底层是 git repo 浅克隆，skill 子目录的 tree SHA 语义完全成立——`upstream_tree` 照常写入，ADR-0013 检测管线（GitHub Trees API / 非 GitHub 走 clone 后比对）完全复用。

## Considered Options

- **所有非 git 源统一走「重下载 + 内容 hash」**：对 wellknown 是浪费（index 的 digest 是现成比对键，不必下载 artifact）；对 archive 是不可能（无从重查）。
- **URL 源以 ETag 为主锚**：服务器不保证 ETag 稳定语义（弱验证、CDN 轮换），内容 hash 才是事实；ETag 只配做预检。
- **marketplace 视作非 git 源（`upstream_tree` 留空）**：形态 1（仓库内固定相对路径）下 tree SHA 完整成立，白白放弃现成检测管线。

## Consequences

- `upstream_tree` 留空的只有 url / wellknown；archive 无任何锚；marketplace 与 local/git/github 一样正常参与更新流。
- registry source 新增 `upstream_digest` 字段（wellknown 专用）。
- well-known 消费端采纳既有约定（`schemas.agentskills.io/discovery/0.2.0`，npx skills 既有实现）——我们是**早期采纳者**，不是发明者；V2-only（无 `$schema` 或非 0.2.0 报「索引格式不受支持」），两条候选路径（`/.well-known/agent-skills/index.json` 与 `/.well-known/skills/index.json`）+ basePath 组合照 npx skills 实现；触发为自动探测（非 github/gitlab/huggingface 域名的 http URL 先试索引，探测不到回落 URL 直下），只消费不发布。
- marketplace 形态 2/3（外部仓库引用 `git-subdir`/`url`）留后续版本，遇到给明确「暂不支持」报错。
- URL 识别扩展名预判、下载后内容校验（PK/gzip/tar 魔数、frontmatter 含 name+description），与预判不符报错并提示显式指定类型，不自动纠正。
