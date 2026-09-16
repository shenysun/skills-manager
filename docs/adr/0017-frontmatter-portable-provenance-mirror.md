# frontmatter 便携 provenance 镜像：registry 单向投影 + gh skill 键位对齐

对标 gh skill 的「provenance travels with the skill」（调研见 `docs/research/competitors-deep-dive-2026-09.md` §1.2/§11.3，源码级字段核实 2026-09-16）：SKILL.md frontmatter `metadata:` 成为 source evidence 的**便携镜像**，registry 保持唯一 source of truth，投影在**所有 registry source 写入点**（install / update / edit --source-* / provenance adopt / 检测校准）统一刷新——「文件到哪证据到哪」不容空窗；镜像被手改或落后视为脏，下次写入点由 registry 静默覆盖重投影。git/github/marketplace 源的镜像字段**逐字对齐 gh skill 的四个键**（`metadata.github-repo` 完整 HTTPS URL、`github-ref`、`github-tree-sha`、`github-path`），换取 `gh skill update` 即时互认（其互操作判定只读这三键）；工具身份与非 git 源一律 `skills-manager-*` 自有键（wellknown 镜像 index URL + digest，url 镜像 URL + 内容 hash；archive/local 不镜像，ADR-0016 同待遇）。反读：import / `provenance adopt` 把 frontmatter 当证据（优先级 frontmatter > lockfile），且**证据即校准**——`github-tree-sha` 直写 `upstream_tree`（与 ADR-0011 的 skillFolderHash 直写 baseline_hash 同构），host 映射 github.com→github 型、`*.ghe.com`→git 型。永不写 `~/.agents/.skill-lock.json`（ADR-0011 红线不变）。

## Considered Options

- **自命名空间键**（`skills-manager-source` 等）：无碰撞、身份清晰，但 gh skill 读不到，互操作归零——放弃本特性最大的外部网络效应。
- **双写**（gh 键 + 自有键全量并存）：非 git 源被迫发明假 github 键或维护两套字段，冗余且语义模糊。
- **独立 mirror-backfill 命令**：镜像与内容写入脱钩，日常落后；改为写入点统一投影 + detect-and-calibrate 幂等补写存量（ADR-0013 同款姿势，无迁移命令）。
- **frontmatter 为 SoT / 双向同步**：用户手改 frontmatter 升级为冲突停摆；改源的正门是 `edit --source-*`。
- **fingerprint 豁免镜像写入**（hash 排除镜像字段）：指纹语义分裂的长期维护成本 > 存量校准补写的一次性 stale 波幅（ADR-0008 auto-refresh 兜底，校准尽量单批跑完）。

## Consequences

- **我们装的 git 源 skill 在 gh skill 视角下「长得像 gh 装的」——这是有意设计**，不是命名事故；`skills-manager-*` 身份键紧邻放置以自证，后续维护者不得「修复」这些 github-* 键。
- 镜像随 distribute 旅行（copy 模式进项目仓库），`gh skill update` 可据此直接接管项目内副本——分发目标是 agent 侧领地（ADR-0007 分发权威模型），C1 foreign-refusal 已防回流污染 hub，不加「请勿绕过」类标记（无强制力且违背 provenance travels 共识）。
- gh skill 自己安装时写的 `~/.agents/.skill-lock.json` 与我们的 frontmatter 镜像构成双工具并存：它的 update 读 SKILL.md 照常工作，互不干扰。
