# Getting Started with Skills Manager

**English** | [简体中文](GETTING_STARTED.zh-CN.md)

Welcome! This guide will help you get started with `skills-manager-cli` in minutes.

## Installation

### Option 1: Use without installing (Recommended)

```bash
npx skills-manager-cli web
```

### Option 2: Install globally

```bash
npm install -g skills-manager-cli
# or
pnpm add -g skills-manager-cli
skills-manager web
```

## Your First Launch

When you run any command for the first time, Skills Manager automatically initializes your **skill home** — a local directory that stores all your skills.

```bash
# This automatically creates and initializes ~/.skills-manager/
skills-manager web
```

Your browser will open to `http://localhost:4777` where you can start managing skills.

### Default locations

Skills Manager checks these locations in order:

1. `--home <path>` — if you specify a path explicitly
2. `SKILL_HOME` — if you set this environment variable
3. Current directory — if it already contains `skills/` and `registry.yaml`
4. `~/.skills-manager/` — the default location (created automatically)

### Skill home structure

After initialization, your skill home will look like:

```
~/.skills-manager/
├── skills/           # Your skill definitions
├── registry.yaml     # Metadata and configuration
├── collections/      # Generated category links (auto-created)
├── .backups/         # Pre-init originals (30-day retention)
└── .skills/
    ├── activity.jsonl         # Operation log
    └── distributions.jsonl    # Distribution index (what went where)
```

## Migrate Existing Skills (init)

Already have skills in `~/.claude/skills`, `~/.cursor/skills`, or other agent runtime directories? `init` folds them into your skill home — the reverse of distribute:

```bash
# Preview what would be imported (no changes made)
skills-manager init --dry-run

# Import everything unambiguous
skills-manager init
```

What happens to each imported skill:

1. The skill **moves into** the skill home (`~/.skills-manager/skills/<name>/`) — the single canonical copy
2. Its original runtime location is **preserved as a backup** (`~/.skills-manager/.backups/`), then becomes a **symlink back to the hub** — every tool keeps loading from its familiar path
3. The registry marks it `imported: true` — provenance is never guessed, but lockfile evidence is adopted when present ([ADR-0011](adr/0011-init-adopts-lockfile-evidence.md)); without evidence the skill stays a snapshot until you supply a source (`edit <skill> --source-git owner/repo --subpath …`) or backfill evidence (`provenance adopt`)

### Handling conflicts

If the same skill name exists in multiple runtime directories (or already in the hub), `init` is non-interactive: it **skips the clash** unless you declare a **conflict priority** for this run, or resolve one skill:

```bash
# This run: prefer Claude's runtime dir, then the shared .agents dir, then keep the hub copy
skills-manager init --prefer claude-code ~/.agents/skills hub

# Override one skill; everything else still follows --prefer
skills-manager init --prefer claude-code --resolve my-skill=hub
```

The first listed source that actually holds a copy wins. The winning copy enters the hub and **all** clashing locations symlink to it. Without `--prefer` / `--resolve`, clashes stay skipped. The dashboard import sheet exposes the same ordered list.

### Rollback

Every import creates a timestamped backup (kept for 30 days, then pruned automatically):

```bash
skills-manager backup list            # see what's saved
skills-manager backup restore my-skill   # roll one skill fully back
```

### Imported skills and updates

Imported skills never get a guessed upstream, but lockfile **evidence is adopted** when present ([ADR-0011](adr/0011-init-adopts-lockfile-evidence.md)) — skills installed by `npx skills` carry a machine-global lockfile, and matching entries become real sources on import, putting those skills straight into the update flow. `doctor` lists what still has no source so staleness stays visible. When you know the origin, supply it and the skill joins the update flow:

```bash
skills-manager edit my-skill --source-git owner/repo --subpath skills/my-skill
```

For skills imported before evidence adoption existed, `skills-manager provenance adopt` backfills the lockfile evidence in one pass.

## Common Tasks

### Check your installation

```bash
skills-manager doctor
```

This shows your skill home location, status, and any issues.

### List installed skills

```bash
skills-manager list
```

### Install skills from GitHub

```bash
# Install all skills from a repo
skills-manager add owner/repo --all

# Or install specific skills
skills-manager add owner/repo --skill skill-name-1 --skill skill-name-2

# Install from other sources
skills-manager add https://github.com/owner/repo.git --all
skills-manager add /local/path/to/skills --all
```

### Backfill missing sources

```bash
skills-manager provenance list          # what's still source-less (two buckets)
skills-manager provenance adopt          # adopt lockfile evidence where it exists
skills-manager edit my-skill --source-git owner/repo --subpath skills/my-skill
```

Evidence is adopted automatically; anything found by *searching* is only ever written after you approve it, one skill at a time (ADR-0012). The official agent skill automates the whole loop: install it, then just tell your agent "补齐所有来源" and it adopts evidence, searches the skills ecosystem (skills.sh / GitHub), verifies candidates against the local copy, and asks you to pick:

```bash
skills-manager add <this-repo-url> --skill skills-manager
skills-manager distribute --to user --skill skills-manager
```

That skill also documents every CLI command for your agent, task by task.

### Open the Dashboard

```bash
skills-manager web

# Optionally run on a different port
skills-manager web --port 5000

# Don't auto-open browser
skills-manager web --no-open
```

The Dashboard provides a visual interface to:
- Browse and search skills
- Install skills from sources
- Distribute skills to agents (Claude, Cursor, Zed, etc.)
- View operation logs

### Using a custom skill home

```bash
# With environment variable
export SKILL_HOME=~/my-skills
skills-manager web

# Or with --home flag (takes precedence)
skills-manager web --home ~/my-skills

# All commands respect --home
skills-manager list --home ~/my-skills
skills-manager doctor --home ~/my-skills
```

## Next Steps

### Add your first skill

1. Open Dashboard: `skills-manager web`
2. Click "＋ Add" in the top right
3. Enter a GitHub repo (e.g., `owner/repo`) or local path
4. Click "Discover" to see available skills
5. Select skills and click "Install"

### Distribute skills to agents

Once skills are installed:

1. In Dashboard: Click "Distribute" on a skill
2. Select agents (Claude Code, Cursor, Zed, etc.)
3. Choose distribution mode: "symlink" (for user scope) or "copy" (for projects)
4. Click "Distribute"

### Update skills

```bash
# See what can be updated
skills-manager update --plan

# Update specific skills
skills-manager update --skill skill-name

# Update all skills
skills-manager update
```

## Need Help?

### Run health checks

```bash
# Comprehensive health check
skills-manager doctor

# Also migrate old skills from a previous version
skills-manager doctor --migrate-views
```

### View available commands

```bash
skills-manager --help
skills-manager web --help
skills-manager doctor --help
skills-manager add --help
```

### See the full CLI reference

Check [docs/CLI.md](CLI.md) for complete command documentation.

## Troubleshooting

### Dashboard won't start

```bash
# Check your system
skills-manager doctor

# Try a different port
skills-manager web --port 5000

# Run without auto-opening browser
skills-manager web --no-open
```

### Skills not showing up

```bash
# List skills
skills-manager list

# Check skill home status
skills-manager doctor
```

### Can't find agents to distribute to

```bash
# See detected agents on your system
skills-manager catalog info

# Refresh agent catalog
skills-manager catalog refresh
```

## Tips & Tricks

### Work with multiple skill homes

```bash
# Project-specific skill home
cd ~/my-project
mkdir .skills-manager
skills-manager web --home ./.skills-manager

# User-level skill home (default)
skills-manager web --home ~/.skills-manager

# Custom location
skills-manager web --home ~/important-skills
```

### Automate with environment variables

```bash
# Set default skill home for your session
export SKILL_HOME=~/my-skills

# All commands now use this skill home
skills-manager list
skills-manager add owner/repo --all
skills-manager web
```

### Scripting

```bash
# Check if skill is installed
skills-manager list | grep "skill-name"

# Get update count
skills-manager update --plan | jq '.updateCount'

# Distribute to all detected agents
skills-manager distribute --to user --skill my-skill  # no --agent = all detected
```

## What's Next?

- Read [docs/CLI.md](CLI.md) for the complete CLI reference
- Explore the [CONTEXT.md](../CONTEXT.md) to understand architecture
- Check the [Changelog](../CHANGELOG.md) for recent updates
