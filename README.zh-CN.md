# Skills Manager

[English](README.md) | **简体中文**

`skills-manager-cli` 是一个本地优先的 CLI 与网页控制台，基于注册表驱动的技能库（skill home）管理 agent、Claude、Codex 的技能。

## 快速开始

**无需任何安装** —— 直接运行：

```sh
npx skills-manager-cli web
```

首次运行时会自动创建并初始化 `~/.skills-manager/`。

**已经在 `~/.claude/skills` 或其他 agent 运行时目录里有技能了？** 用 `skills-manager init` 一键收纳 —— 内容移入技能库，原位置变成软链接（会先备份）：

```sh
skills-manager init --dry-run   # 预览
skills-manager init             # 导入
```

或者全局安装：

```sh
npm install -g skills-manager-cli
# 或
pnpm add -g skills-manager-cli
skills-manager web
```

👉 **[查看入门指南](docs/GETTING_STARTED.zh-CN.md)** 了解详细用法与常见任务。

## 安装与运行

免安装直接使用：

```sh
npx skills-manager-cli web
```

或从已发布的包/本地打包的 tarball 全局安装：

```sh
npm install -g skills-manager-cli
# 或
pnpm add -g skills-manager-cli
skills-manager web
skills-manager doctor
```

`web` 默认自动打开本地 Vue/Fastify 控制台。加 `--no-open` 可保持浏览器关闭。

## 技能库（skill home）结构

一个技能库包含：

- `skills/`：规范技能目录，扁平存放为 `skills/<skill-name>/SKILL.md`
- `views/`：生成的消费方软链接树，如 `views/agents/` 和 `views/claude/`
- `collections/`：生成的分类软链接树
- `registry.yaml`：元数据、来源、消费方、分类、source 与更新策略
- `.skills/activity.jsonl`：控制台/CLI 写入的操作记录

技能库解析优先级：

1. `--home <path>`
2. `SKILL_HOME`
3. 当前目录（当它已经是一个技能库时）
4. `~/.skills-manager`（自动初始化）

## 常用命令

```sh
skills-manager web --home ~/.skills-manager
skills-manager doctor --home ~/.skills-manager
skills-manager list --home ~/.skills-manager
skills-manager add owner/repo --all --consumer agents --consumer claude --yes
skills-manager update --plan
skills-manager update --skill my-skill
skills-manager init --dry-run                    # 预览运行时技能导入
skills-manager init --prefer claude-code hub     # 本次导入的冲突优先级
skills-manager init --resolve my-skill=cursor    # 按冲突决策导入
skills-manager backup list                       # 查看 init 备份
skills-manager backup restore my-skill           # 回滚某次导入
skills-manager edit my-skill --source-url https://github.com/owner/repo
skills-manager archive old-skill
```

来源（source）支持 GitHub 简写（`owner/repo`）、Git URL、GitHub tree URL 或本地路径。

## 开发

```sh
pnpm install
pnpm run build
pnpm test
```

## 文档

- **[入门指南](docs/GETTING_STARTED.zh-CN.md)** —— 安装、首次启动、常见任务
- **[CLI 参考](docs/CLI.zh-CN.md)** —— 完整命令参考与进阶用法
- **[架构](CONTEXT.md)** —— 项目结构与设计决策（英文）
