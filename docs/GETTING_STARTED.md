# Getting Started with Skills Manager

Welcome! This guide will help you get started with `@shenysun/skills-manager` in minutes.

## Installation

### Option 1: Use without installing (Recommended)

```bash
npx @shenysun/skills-manager dashboard
```

### Option 2: Install globally

```bash
npm install -g @shenysun/skills-manager
skills-manager dashboard
```

## Your First Launch

When you run any command for the first time, Skills Manager automatically initializes your **skill home** — a local directory that stores all your skills.

```bash
# This automatically creates and initializes ~/.skills-manager/
skills-manager dashboard
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
├── views/            # Generated symlink trees (auto-created)
├── collections/      # Generated category links (auto-created)
└── .skills/
    └── activity.jsonl  # Operation log
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
3. The registry marks it `imported: true` — provenance is unknown, so Skills Manager will not try to update it

### Handling conflicts

If the same skill name exists in multiple runtime directories (or already in the hub), `init` is non-interactive: it **skips the clash and reports it** with a suggested resolution:

```bash
# Pick which copy wins (agent id from the report, or 'hub' to keep the hub copy)
skills-manager init --resolve my-skill=cursor
skills-manager init --resolve my-skill=hub
```

The winning copy enters the hub and **all** clashing locations symlink to it.

### Rollback

Every import creates a timestamped backup (kept for 30 days, then pruned automatically):

```bash
skills-manager backup list            # see what's saved
skills-manager backup restore my-skill   # roll one skill fully back
```

### Imported skills and updates

Imported skills are snapshots — Skills Manager doesn't know their upstream. `doctor` lists imported skills without a managed source so staleness stays visible. When you know the origin, supply it and the skill joins the normal update flow:

```bash
skills-manager edit my-skill --source-url https://github.com/owner/repo
```

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

### Open the Dashboard

```bash
skills-manager dashboard

# Optionally run on a different port
skills-manager dashboard --port 5000

# Don't auto-open browser
skills-manager dashboard --no-open
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
skills-manager dashboard

# Or with --home flag (takes precedence)
skills-manager dashboard --home ~/my-skills

# All commands respect --home
skills-manager list --home ~/my-skills
skills-manager doctor --home ~/my-skills
```

## Next Steps

### Add your first skill

1. Open Dashboard: `skills-manager dashboard`
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
skills-manager dashboard --help
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
skills-manager dashboard --port 5000

# Run without auto-opening browser
skills-manager dashboard --no-open
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
skills-manager dashboard --home ./.skills-manager

# User-level skill home (default)
skills-manager dashboard --home ~/.skills-manager

# Custom location
skills-manager dashboard --home ~/important-skills
```

### Automate with environment variables

```bash
# Set default skill home for your session
export SKILL_HOME=~/my-skills

# All commands now use this skill home
skills-manager list
skills-manager add owner/repo --all
skills-manager dashboard
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
