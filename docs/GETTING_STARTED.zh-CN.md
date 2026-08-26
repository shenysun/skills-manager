# Skills Manager 入门指南

[English](GETTING_STARTED.md) | **简体中文**

欢迎！本指南帮你几分钟内上手 `agent-skills-manager`。

## 安装

### 方式一：免安装直接使用（推荐）

```bash
npx agent-skills-manager web
```

### 方式二：全局安装

```bash
npm install -g agent-skills-manager
# 或
pnpm add -g agent-skills-manager
skills-manager web
```

## 首次启动

首次运行任意命令时，Skills Manager 会自动初始化你的**技能库（skill home）** —— 一个存放所有技能的本地目录。

```bash
# 会自动创建并初始化 ~/.skills-manager/
skills-manager web
```

浏览器会自动打开 `http://localhost:4777`，即可开始管理技能。

### 默认位置

Skills Manager 按以下顺序查找技能库：

1. `--home <path>` —— 显式指定的路径
2. `SKILL_HOME` —— 环境变量
3. 当前目录 —— 当它已包含 `skills/` 和 `registry.yaml` 时
4. `~/.skills-manager/` —— 默认位置（自动创建）

### 技能库结构

初始化完成后，你的技能库长这样：

```
~/.skills-manager/
├── skills/           # 你的技能定义
├── registry.yaml     # 元数据与配置
├── views/            # 生成的软链接树（自动创建）
├── collections/      # 生成的分类链接（自动创建）
└── .skills/
    └── activity.jsonl  # 操作日志
```

## 迁移已有技能（init）

已经在 `~/.claude/skills`、`~/.cursor/skills` 或其他 agent 运行时目录里有技能？`init` 会把它们收进技能库 —— 它是 distribute 的反向操作：

```bash
# 预览将要导入的内容（不做任何修改）
skills-manager init --dry-run

# 导入所有无歧义的技能
skills-manager init
```

每个被导入的技能会发生什么：

1. 技能**移入**技能库（`~/.skills-manager/skills/<name>/`）—— 成为唯一的规范副本
2. 原运行时位置**先备份**（`~/.skills-manager/.backups/`），然后变成**指回技能库的软链接** —— 每个工具仍从熟悉的位置加载
3. 注册表将其标记为 `imported: true` —— 来源未知，Skills Manager 不会尝试更新它

### 处理冲突

当同名技能存在于多个运行时目录（或已在技能库中）时，`init` 保持非交互：**跳过冲突并报告**，同时给出建议的解决方式：

```bash
# 指定哪个副本胜出（报告中的 agent id，或 'hub' 保留技能库副本）
skills-manager init --resolve my-skill=cursor
skills-manager init --resolve my-skill=hub
```

胜出的副本进入技能库，**所有**冲突位置都软链接到它。

### 回滚

每次导入都会创建带时间戳的备份（保留 30 天，之后自动清理）：

```bash
skills-manager backup list            # 查看已保存的备份
skills-manager backup restore my-skill   # 完整回滚某个技能
```

### 导入的技能与更新

导入的技能是快照 —— Skills Manager 不知道它们的上游。`doctor` 会列出没有受管来源的导入技能，让陈旧状态始终可见。当你知道来源时，补上它，技能就进入正常的更新流程：

```bash
skills-manager edit my-skill --source-url https://github.com/owner/repo
```

## 常见任务

### 检查安装状态

```bash
skills-manager doctor
```

会显示技能库位置、健康状态和存在的问题。

### 列出已安装的技能

```bash
skills-manager list
```

### 从 GitHub 安装技能

```bash
# 安装仓库中的全部技能
skills-manager add owner/repo --all

# 或安装指定技能
skills-manager add owner/repo --skill skill-name-1 --skill skill-name-2

# 从其他来源安装
skills-manager add https://github.com/owner/repo.git --all
skills-manager add /local/path/to/skills --all
```

### 打开控制台

```bash
skills-manager web

# 可选：换一个端口
skills-manager web --port 5000

# 不自动打开浏览器
skills-manager web --no-open
```

控制台提供可视化界面，可以：

- 浏览和搜索技能
- 从来源安装技能
- 把技能分发到各 agent（Claude、Cursor、Zed 等）
- 查看操作日志

### 使用自定义技能库

```bash
# 用环境变量
export SKILL_HOME=~/my-skills
skills-manager web

# 或用 --home 参数（优先级更高）
skills-manager web --home ~/my-skills

# 所有命令都支持 --home
skills-manager list --home ~/my-skills
skills-manager doctor --home ~/my-skills
```

## 接下来

### 添加你的第一个技能

1. 打开控制台：`skills-manager web`
2. 点击右上角的「＋ 添加」
3. 输入 GitHub 仓库（如 `owner/repo`）或本地路径
4. 点击「发现」查看可用技能
5. 选择技能并点击「安装」

### 分发技能到 agent

技能安装完成后：

1. 在控制台：点击某个技能的「分发」
2. 选择 agent（Claude Code、Cursor、Zed 等）
3. 选择分发模式：「symlink」（用户范围）或「copy」（项目）
4. 点击「分发」

### 更新技能

```bash
# 查看哪些技能可以更新
skills-manager update --plan

# 更新指定技能
skills-manager update --skill skill-name

# 更新全部技能
skills-manager update
```

## 需要帮助？

### 运行健康检查

```bash
# 全面健康检查
skills-manager doctor

# 顺带迁移旧版本遗留的技能
skills-manager doctor --migrate-views
```

### 查看可用命令

```bash
skills-manager --help
skills-manager web --help
skills-manager doctor --help
skills-manager add --help
```

### 查看完整 CLI 参考

见 [docs/CLI.zh-CN.md](CLI.zh-CN.md)。

## 故障排查

### 控制台启动失败

```bash
# 检查系统状态
skills-manager doctor

# 换一个端口试试
skills-manager web --port 5000

# 不自动打开浏览器运行
skills-manager web --no-open
```

### 技能没有显示

```bash
# 列出技能
skills-manager list

# 检查技能库状态
skills-manager doctor
```

### 找不到可分发的 agent

```bash
# 查看本机检测到的 agent
skills-manager catalog info

# 刷新 agent 目录
skills-manager catalog refresh
```

## 使用技巧

### 管理多个技能库

```bash
# 项目级技能库
cd ~/my-project
mkdir .skills-manager
skills-manager web --home ./.skills-manager

# 用户级技能库（默认）
skills-manager web --home ~/.skills-manager

# 自定义位置
skills-manager web --home ~/important-skills
```

### 用环境变量自动化

```bash
# 为当前会话设置默认技能库
export SKILL_HOME=~/my-skills

# 之后所有命令都使用这个技能库
skills-manager list
skills-manager add owner/repo --all
skills-manager web
```

### 脚本集成

```bash
# 检查技能是否已安装
skills-manager list | grep "skill-name"

# 获取可更新数量
skills-manager update --plan | jq '.updateCount'

# 分发到所有检测到的 agent
skills-manager distribute --to user --skill my-skill  # 不加 --agent = 所有检测到的
```

## 下一步？

- 阅读 [docs/CLI.zh-CN.md](CLI.zh-CN.md) 完整 CLI 参考
- 阅读 [CONTEXT.md](../CONTEXT.md) 了解架构（英文）
- 查看 [更新日志](../CHANGELOG.md)
