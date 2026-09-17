# Roadmap — 候选方向与优先级

> 依据：2026-09 竞品调研（[competitors-2026-09.md](research/competitors-2026-09.md) + [competitors-deep-dive-2026-09.md](research/competitors-deep-dive-2026-09.md) §11）。
> 本文只记录**排序决策与状态**；论证细节一律回到两份调研文档。新会话/agent 以本文为「下一步做什么」的入口。

## 已完成

- **#1 SEO / 命名防御**（2026-09-16 完成）：README 双语定位区分（vs xingkongliang 桌面版）+ 五条差异化主张；package.json description/keywords 重写。
  - **待复测检查点**：npm 索引随下次发版生效后，`npm search skills-manager --searchlimit=10` 对比基线（2026-09-16 测得 **9/10**，根因旧 keywords 缺字面词）；`npm view skills-manager-cli keywords` 确认上线。
- **#2 Frontmatter 便携 provenance + #3 引用层 `get`**（2026-09-17 完成，feature `provenance-get`）：打包一张特性票交付（7 张实施票，QA 27/27 场景 0 缺陷，commits c5d5669…bd44dad）。裁定见 **ADR-0017**（registry 是 SoT、frontmatter 单向投影、五写入点闭口、git 源逐字对齐 gh skill `metadata.github-*` 四键换互认、frontmatter 优先 lockfile 兜底、证据即校准、fingerprint 不豁免）；`get` v1 hub-only、完整 SKILL.md stdout、`--path` 只读借目录。遗留：marketplace 写入点无 install seam 实测（纯函数层已覆盖）。
- **#4 上下文成本可视化**（2026-09-17 完成，feature `context-cost`）：常驻成本账本（ADR-0018）——只读核心按物理 runtime 路径分组统计 frontmatter `name+description` 常驻 token（char-approx，`≈` 展示 + `method` 元数据），三个薄适配共享同一核心：`cost` CLI（人读 + `--json` 三层结构）、doctor `residentCost` 结构化字段（仅 scattered 告警）、dashboard `GET /api/cost`（顶部 inline 常驻线 + preview 接入足迹，懒加载）；建议只指向 `undistribute`、只报告不执行，manager skill 收录查账本→建议收回工作流。
- **#5 命名预设（named presets）**（2026-09-17 完成，feature `preset-bundle`）：命名的类别清单档位（ADR-0019）——registry 顶层 `presets:` map + 独立 `preset` 命令组（set/list/remove/apply）。`preset apply` 复用 ADR-0015 路径级严格改写并盖档位戳（裸 `categories apply` 清戳、`remove` 级联清、rollback 随行恢复），空解析与类别不存在两道硬错闸，成功尾部带常驻成本行（复用 ADR-0018 核心）；可见面为 `preset list`（挂载足迹 + 漂移诚实暴露）+ `categories status`（档位名并列）。supersede ADR-0015 Avoid 条款「named switchable profiles」。

## 第一梯队（下一个特性，建议打包一张票）

（已清空——下一批从第三梯队 #6 取。）

## 第二梯队

（已清空——原 #5 命名预设已完成，见「已完成」。）

## 第三梯队（大票，先做 MVP）

- **#6 多机同步**：走 **hub git 化 MVP**（hub 本身为 git repo，push/pull 即同步，不做 skill 级合并——git 已是合并工具），不与桌面对手的设备码/合并全功能正面拼。被 xingkongliang 与 skl 两面夹击，须做但不急。
- **#7 Find 接入 skills.sh**：search API 已实测（含 installs 字段）；作为 ADR-0012 search 层的第三通道。

## 缓做

- **create/push**：gh skill publish（GitHub 绑定）与 asm publish（自建 registry）各占一头；我们的通用位（任意 git host + well-known）存在但优先级靠后。
- **装前安全扫描**：生态未收敛（SkillSpector 等），做成 install/update 可插拔 hook，等赢家出现再接。

## 维护约定

- 完成一项即更新本文状态；排序变更须注明依据（对应调研文档小节）。
- 竞品动态按 competitors-2026-09.md §6 跟踪节奏月度扫描；重大变化（如官方宣布跨 agent 分发）触发本文重排。
