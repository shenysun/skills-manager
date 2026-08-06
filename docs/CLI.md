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

### 可视化后台

```zsh
"$SKILL_HOME/bin/skills" admin
"$SKILL_HOME/bin/skills" admin --port 4777 --host 127.0.0.1
```

后台支持中文 / English，并可视化完成：浏览、搜索、按来源更新、批量更新、发现并安装、暴露/隐藏消费者。

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


### 在菜单中更新 skills

推荐日常通过菜单更新：

```zsh
"$SKILL_HOME/bin/skills" menu
```

进入 `更新 skills（单个 / 批量 / 按来源）` 后有四种方式：

- `更新某一个 skill（从注册表来源）`：根据 `registry.yaml` 中该 skill 的 `source.url`、`source.subpath`、`source.ref` 更新单个 skill。
- `批量选择 skills 更新（从注册表来源）`：在已安装且有来源记录的 skills 中多选更新。
- `按来源仓库更新（自动匹配同仓库已安装 skills）`：先选择一个注册表中的来源仓库，再自动列出这个来源下已安装的 skills，默认勾选该仓库下全部 skill。
- `输入 URL/Git 来源，发现后选择安装/覆盖`：输入新的 URL / GitHub owner/repo / 本地路径，扫描 `SKILL.md` 后选择安装或覆盖。

更新后建议：

```zsh
"$SKILL_HOME/bin/skills" doctor
git diff
git add .
git commit -m "Update selected skills"
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

支持 GitHub tree URL，会解析 URL 中的 branch/ref，并从指定子路径开始发现：

```zsh
"$SKILL_HOME/bin/skills" add https://github.com/owner/repo/tree/main/skills --list
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

## 说明

- `install-git` 旧命令仍作为隐藏兼容命令存在，但不再出现在 help、菜单或文档主流程中；新安装请使用 `skills add <source>`。
- live switch / rollback 不再暴露在 CLI 中，避免在正式切换前误操作 `~/.agents/skills` 或 `~/.claude/skills`。

## 发布 npm 包

当前包名配置为 `@sunyongshen/skills`，CLI bin 名称为 `skills`。发布前请确认你拥有该 npm scope；如果没有，请修改 `package.json` 的 `name`。

```zsh
pm run build
npm pack --dry-run
npm publish --access public
```

发布后安装：

```zsh
npm i -g @sunyongshen/skills
skills doctor
skills admin
```
