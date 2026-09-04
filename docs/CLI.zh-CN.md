# Skills Manager CLI

[English](CLI.md) | **简体中文**

`skills-manager-cli` 提供 `skills-manager` 可执行命令，管理本地优先的技能库。

## 技能库解析

优先级：

1. `--home <path>`
2. `SKILL_HOME`
3. 当前目录（当它已包含 `skills/`、`views/`、`collections/` 和 `registry.yaml` 时）
4. `~/.skills-manager`（自动初始化）

初始化会创建 `skills/`、`views/`、`collections/`、`registry.yaml`，以及 `.skills/activity.jsonl` 的父目录。

## 命令

```sh
skills-manager web --home ./my-skill-home
skills-manager doctor --home ./my-skill-home
skills-manager catalog info --home ./my-skill-home
skills-manager catalog refresh --home ./my-skill-home
skills-manager list --home ./my-skill-home
skills-manager add <source> --all --yes
skills-manager update --plan
skills-manager update --skill my-skill
skills-manager update --source '<source-key>'
skills-manager distribute --to user --skill my-skill --agent claude-code --agent zed
skills-manager distribute --to project --project ./repo --skill my-skill --agent cursor --mode copy
skills-manager undistribute --to user --skill my-skill --agent claude-code
skills-manager redistribute --outdated
skills-manager redistribute --refresh --to project --project ./repo
skills-manager status
skills-manager init --dry-run
skills-manager init --agent claude-code --agent cursor
skills-manager init --prefer claude-code ~/.agents/skills hub
skills-manager init --resolve my-skill=cursor --resolve other-skill=hub
skills-manager backup list
skills-manager backup restore my-skill
skills-manager edit my-skill --source-url https://github.com/owner/repo
skills-manager archive old-skill
skills-manager rebuild-collections
```

distribute 的目标可以是任意目录中的 agent id（`--agent`，可重复）。省略 `--agent` 时作用于本机检测到的 agent 集合。用户范围默认 `--mode symlink`，项目范围默认 `--mode copy`；每次应用只能用一种模式。

### 副本过期与自动刷新（ADR-0008）

`copy` 模式的目标在技能库内容变化后会落后于技能库；symlink 目标始终直连技能库实时内容，永不过期。过期判定只看 fingerprint，刷新是整棵受管子树替换（受管副本目标里的本地文件不会保留——技能库是唯一权威）。

- `add` / `update` **级联**：技能库写入成功后，自动刷新所涉技能的每个过期副本目标；单条失败记录在索引条目上，不阻断兄弟目标。
- `skills-manager status` 输出 `outdated: N, errored: M`，列出刷新错误的运行时路径，并给出修复命令。
- `skills-manager redistribute --refresh`（`--outdated` 的别名）刷新全部过期副本目标，可用 `--to` / `--project` 过滤；输出 `Refreshed N, errored M.`
- `add` / `update` 在仍有其他过期目标时，末尾追加一行提醒。
- 仪表盘的技能行显示带数量的过期徽标和一键刷新按钮。

### init（反向导入）

`init` 是 distribute 的反向操作：扫描**检测到的目录 agent 的全局运行时目录**（`~/.claude/skills`、`~/.cursor/skills`、…），把发现的技能导入技能库，并把每个原位置变成指回 `skills/<name>/` 的受管软链接（原内容会先移入 `<home>/.backups/`；备份 30 天后过期）。导入条目标记 `imported: true` 且无 source —— Skills Manager 从不猜测来源。CLI 是非交互的：冲突默认跳过，除非这次导入声明了 **冲突优先级**（`--prefer <运行时目录|agent-id|hub...>`）或逐条 `--resolve`。`--prefer` 里第一个真正持有该技能的来源胜出；`--resolve` 覆盖单个技能。整树指纹相同的副本算同一实体，不是冲突。prefer 项必须是 `hub` 或本轮扫描到的目录。Dashboard 导入面板是同一套列表。见 [ADR-0006](adr/0006-init-reverse-import-symlinks.md) 与 [ADR-0009](adr/0009-init-conflict-priority.md)。

## Agent 目录快照

agent 表（id、运行时路径、检测规则）以内置快照的形式随包分发，提取自 [vercel-labs/skills](https://github.com/vercel-labs/skills)（MIT；文件内有署名）。`skills-manager catalog info` 显示快照戳（上游 commit、日期、年龄）和检测到的 agent 集合 —— 与 `npx skills` 不带 `-a` 时的判定一致。`skills-manager catalog refresh` 重新下载上游、重新提取，并把更新的快照存为技能库本地的覆盖文件 `<home>/.skills/agent-catalog.json`；当生效快照超过 90 天时 doctor 会告警。

开发期间重新生成内置快照：`pnpm run catalog:extract`（下载 `src/agents.ts` + `src/detect-agent.ts`，提取后写入 `src/core/catalog/agent-catalog.json`）。

`<source>` 可以是 GitHub 简写（`owner/repo`）、Git URL、GitHub tree URL 或本地路径。

## 控制台（web）

```sh
skills-manager web --home ~/.skills-manager
skills-manager web --no-open
```

控制台由 Fastify 路由驱动，提供本地 Vue/Vite 界面。控制台中的写操作会向 `.skills/activity.jsonl` 写入活动记录，磁盘变更保持对 `git diff` 可见。

## 开发

```sh
pnpm install
pnpm run build
pnpm test
```

测试套件包含编译产物覆盖：`tests/cli/cli-bin.test.ts` 以真实子进程启动 `dist/cli.js`（技能库解析、help、migrate-views），`tests/package/package-smoke.test.ts` 打包 tarball、安装到临时目录，并驱动安装后的 bin 与控制台 API。
