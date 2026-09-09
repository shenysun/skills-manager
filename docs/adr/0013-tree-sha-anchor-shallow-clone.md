# 版本锚点用子目录 tree SHA；传输层浅克隆 + GitHub API 更新检测

对标 `npx skills`（vercel-labs/skills，调研见 `docs/research/npx-skills-download-strategy.md`）后决定：skill 的更新判定锚点从 repo 级 commit SHA 换成 **skill 子目录的 git tree SHA**（registry 新增 `upstream_tree` 字段，`upstream_commit` 保留作 provenance 记录）；git 下载统一浅克隆（`--depth 1`，branch/tag 用 `--branch`，裸 SHA 用 init + `fetch --depth 1`）；GitHub 源的更新检测走 GitHub Trees API（gh CLI 优先、匿名兜底、内存 TTL 缓存），不再 clone。核心理由：上游无关 commit（如改 README）不应点亮更新按钮——tree SHA 让「有更新」只在 skill 内容真变时成立。

## Considered Options

- **锚点 = repo commit SHA（现状）+ API 比 commit**：实现最简、零迁移，但任何上游 commit 都触发误报更新，用户点了更新跑完发现内容没变。
- **blob-filter（`--filter=blob:none`）+ sparse-checkout**：npx skills 未采用，业界无先例背书，且与「扫描全仓库发现 SKILL.md」的 discovery 冲突。
- **服务端打包快路径（skills.sh 模式）**：需要自建下载服务，成本不同量级，放弃。
- **本地镜像缓存**：无业界先例，当前收益不明确，不自选。

## Consequences

- **检测即校准**：GitHub API 检测拉递归树时顺手把 `upstream_tree` 写回 registry（dashboard state 请求产生幂等低频写入），存量 60 条无迁移命令。
- 非 GitHub git 源同样浅克隆，但其更新检测无 API 可用，维持 clone 后比对。
- dashboard 检测失败不再静默：`~/.skills-manager/.skills/dashboard.log` + UI「检测失败」角标（区别于「无更新」）。
- clone 网络失败（HTTP/2 `curl 92` 类）以进程内 HTTP/1.1 重试一次兜底（`GIT_CONFIG_COUNT` 注入，不改用户全局 git 配置）。
