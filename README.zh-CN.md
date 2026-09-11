# Skills Manager

[English](README.md) | **简体中文**

在**对话里**管理你的 agent skills：一条 `npx` 命令装上 manager skill，之后一切都直接吩咐你的 agent——安装、导入、分发、更新、补齐来源。任何会加载 skills 的 agent 都能用（Claude Code、Codex、Cursor、…）。

## 快速开始

```sh
npx skills-manager-cli
```

这就是全部的安装步骤。bootstrap 会创建技能库（`~/.skills-manager`），从包内副本把 **manager skill** 种进库，并（以软链接）挂载到它检测到的 agent——展示一次多选让你确认清单。

然后回到你的 agent，说：

> **帮我看看我的 skills：有哪些、装到哪些 agent 了、有没有能更新的**

**`~/.claude/skills` 等运行时目录里已经有 skills 了？** 不必在安装时迁移——直接吩咐：

> 帮我把现有的 skills 导入 skills-manager 并整理好来源

内容会移入库中，原位置变成软链接（先备份）。想先自己预览？`skills-manager init --dry-run`。

## 工作原理

```text
~/.skills-manager                        ← 技能库：唯一的内容权威
     skills/<name>/  ·  registry.yaml
          │
          │  分发（软链接 / 拷贝）
          ▼
~/.claude/skills   ~/.cursor/skills   …  ← agent 运行时目录
          ▲
          │  通过 `npx skills-manager-cli …` 驱动
   你的 agent  ⇄  manager skill
```

- **manager skill** 是主界面（[ADR-0014](docs/adr/0014-manager-skill-first-bootstrap.md)）：npx bootstrap 只装它、别的什么都不做；之后所有管理动作都通过它在 agent 对话里完成。还没装任何 agent？bootstrap 照样建好技能库，并告诉你之后怎么挂载。
- 它自己保持最新：CLI 每次运行都会对比包内副本与库内副本并静默刷新——除非你自己改过库内副本，那就是你的了，不再碰它。
- 底层的 CLI 是纯粹的引擎（JSON 输出、非交互 flag）——见 [CLI 参考](docs/CLI.zh-CN.md)。

## 类别集：只加载你需要的

agent 是整个目录 wholesale 加载 skills 的——没有 per-skill 开关。领域类别把这个开关带到技能库：用你自己的词表给 skill 打标（前端 / 金融 / backend——自由字符串，不受控词表），再应用一个类别集，该 agent 的运行时目录就**恰好**只装这些领域。

> 帮我把 show-me 归到前端类，然后让 claude-code 只加载前端的 skills

```sh
skills-manager categories set show-me 前端 web    # 覆盖式替换整个标签列表
skills-manager categories add show-me 前端        # 增量补标
skills-manager categories list                    # 全库标签 + 每标签 skill 数
skills-manager categories apply 前端 金融 -a claude-code   # 把运行时目录改写为恰好该集合
skills-manager categories apply --all             # 解散过滤，恢复全部受管 skill
skills-manager categories status                  # 各路径已应用集合 + 漂移
```

apply 是显式的、可逆的快照：缺的分发、集合外（含未打标）的受管 skill 撤除；manager skill 自身与 foreign 条目永不触碰；重跑同一 apply 零变化。之后改标签不会自动推送——`categories status` 报漂移，重跑 `apply` 即收敛。`distribute rollback --to user` 会把运行时内容和类别集记录一起恢复。共享同一物理运行时目录的 agent（agent family）必然共享同一个集合。见 [ADR-0015](docs/adr/0015-domain-categories-category-set-loading.md)。

## 技能库（skill home）结构

一个技能库包含：

- `skills/`：规范技能目录，扁平存放为 `skills/<skill-name>/SKILL.md`
- `collections/`：生成的分类软链接树（仅供浏览）
- `registry.yaml`：元数据 —— 领域类别、旧版分类、标签、消费方、来源（仓库、子路径、ref、基线）、更新策略
- `.skills/`：分发索引（`distributions.jsonl`）、活动日志、可选的 agent 目录覆盖
- `.backups/`：init 前的原始内容，保留 30 天

技能库解析优先级：

1. `--home <path>`
2. `SKILL_HOME`
3. 当前目录（当它已经是一个技能库时）
4. `~/.skills-manager` —— 仅由 bootstrap 创建；其他命令只会提示你先跑 bootstrap，不再隐式创建

## 常用命令

```sh
npx skills-manager-cli                            # bootstrap（不带子命令时的默认行为）
skills-manager bootstrap --agent claude-code      # 脚本化 bootstrap / 之后再挂载
skills-manager doctor
skills-manager list
skills-manager add owner/repo --all --yes
skills-manager distribute --to user --skill my-skill --agent claude-code
skills-manager update --plan
skills-manager update --skill my-skill
skills-manager init --dry-run                    # 预览运行时技能导入
skills-manager init --prefer claude-code hub     # 本次导入的冲突优先级
skills-manager init --resolve my-skill=cursor    # 按冲突决策导入
skills-manager backup list                       # 查看 init 备份
skills-manager backup restore my-skill           # 回滚某次导入
skills-manager edit my-skill --source-git owner/repo --subpath skills/my-skill
skills-manager provenance list                   # 仍缺来源的技能清单
skills-manager provenance adopt                  # 补采锁文件证据
skills-manager categories set my-skill 前端       # 打领域类别标签
skills-manager categories apply 前端 -a claude-code  # 只加载该领域
skills-manager categories status                  # 已应用集合 + 漂移
skills-manager archive old-skill
```

来源（source）支持 GitHub 简写（`owner/repo`）、Git URL、GitHub tree URL 或本地路径。

## 可选：全局安装与 dashboard

想直接敲裸命令？全局安装：

```sh
npm install -g skills-manager-cli   # 或 pnpm add -g skills-manager-cli
```

想要可视化界面？本地 dashboard 是对话之外的可选替代：

```sh
skills-manager web          # http://127.0.0.1:4777，--no-open 不自动开浏览器
```

它在单页里提供同一个技能库：浏览、安装、更新、分发。它不会创建技能库——请先跑 bootstrap。

## 开发

```sh
pnpm install
pnpm run build
pnpm test
```

## 文档

- **[入门指南](docs/GETTING_STARTED.zh-CN.md)** —— 首次运行、导入现有技能、常见任务
- **[CLI 参考](docs/CLI.zh-CN.md)** —— 完整命令参考与进阶用法
- **[架构](CONTEXT.md)** —— 项目结构与设计决策（英文）
