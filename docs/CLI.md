# skills CLI

`skills` 是中央 skill 仓库的命令行管理工具，基于 TypeScript、Commander 和 Inquirer。

## 入口

```zsh
export SKILL_HOME="$HOME/Documents/Cheese/ai/agent-skills"
"$SKILL_HOME/bin/skills" doctor
```

也可以从仓库本地全局链接：

```zsh
cd "$SKILL_HOME"
npm run build
npm link
skills doctor
```

## 命令

### 交互式菜单

```zsh
"$SKILL_HOME/bin/skills" menu
```

### 健康检查

```zsh
"$SKILL_HOME/bin/skills" doctor
```

### 列出 skills

```zsh
"$SKILL_HOME/bin/skills" list
"$SKILL_HOME/bin/skills" list --consumer agents
"$SKILL_HOME/bin/skills" list --consumer claude
"$SKILL_HOME/bin/skills" list --category coding
```

### 切换线上入口

预览，不执行：

```zsh
"$SKILL_HOME/bin/skills" switch --dry-run
```

直接执行，跳过确认：

```zsh
"$SKILL_HOME/bin/skills" switch --yes
```

### 回滚线上入口

交互式选择备份：

```zsh
"$SKILL_HOME/bin/skills" rollback
```

指定时间戳：

```zsh
"$SKILL_HOME/bin/skills" rollback YYYYMMDD-HHMMSS --yes
```

### 重建生成链接

```zsh
"$SKILL_HOME/bin/skills" rebuild-views
"$SKILL_HOME/bin/skills" rebuild-collections
```

### 暴露或隐藏 skill

```zsh
"$SKILL_HOME/bin/skills" expose ask-matt agents claude
"$SKILL_HOME/bin/skills" hide ask-matt claude
```


### 按来源发现并安装 skills（推荐）

这种方式更接近 `npx skills` 的使用体验：先给 Git URL / GitHub 仓库 / 本地路径，CLI 自动发现 `SKILL.md`，再让你选择要安装的 skill。

只查看可安装项：

```zsh
"$SKILL_HOME/bin/skills" add https://github.com/owner/repo.git --list
"$SKILL_HOME/bin/skills" add owner/repo --list
"$SKILL_HOME/bin/skills" add /absolute/path/to/repo --list
```

交互选择安装：

```zsh
"$SKILL_HOME/bin/skills" add owner/repo
```

安装全部：

```zsh
"$SKILL_HOME/bin/skills" add owner/repo --all --consumer agents claude
```

只安装指定 skill：

```zsh
"$SKILL_HOME/bin/skills" add owner/repo --skill ask-matt --consumer agents claude
```

支持 GitHub tree URL，会从指定子路径开始发现：

```zsh
"$SKILL_HOME/bin/skills" add https://github.com/owner/repo/tree/main/skills --list
```

### 从 Git 安装（旧方式）

```zsh
"$SKILL_HOME/bin/skills" install-git   foo-skill   https://github.com/someone/some-skills.git   skills/foo-skill   agents claude
```

### 从 Git 更新

读取 `registry.yaml` 中的来源：

```zsh
"$SKILL_HOME/bin/skills" update-git foo-skill
```

临时覆盖来源：

```zsh
"$SKILL_HOME/bin/skills" update-git   foo-skill   https://github.com/someone/some-skills.git   skills/foo-skill
```

### 收编 installer 安装到 view 的真实目录

```zsh
"$SKILL_HOME/bin/skills" adopt agents new-skill claude
"$SKILL_HOME/bin/skills" adopt claude new-skill agents
```

## 标准收尾

```zsh
cd "$SKILL_HOME"
"$SKILL_HOME/bin/skills" doctor
git diff
git add .
git commit -m "Describe skill change"
```
