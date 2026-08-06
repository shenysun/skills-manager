# skillctl CLI

`skillctl` is the command interface for this central skill repository.

## Entry point

```zsh
export SKILL_HOME="$HOME/Documents/Cheese/ai/agent-skills"
"$SKILL_HOME/bin/skillctl" doctor
```

Optional global install from this repo:

```zsh
cd "$SKILL_HOME"
npm run build
npm link
skillctl doctor
```

## Commands

### Interactive menu

```zsh
"$SKILL_HOME/bin/skillctl" menu
```

### Health check

```zsh
"$SKILL_HOME/bin/skillctl" doctor
```

### List skills

```zsh
"$SKILL_HOME/bin/skillctl" list
"$SKILL_HOME/bin/skillctl" list --consumer agents
"$SKILL_HOME/bin/skillctl" list --consumer claude
"$SKILL_HOME/bin/skillctl" list --category coding
```

### Switch live entry points

Preview:

```zsh
"$SKILL_HOME/bin/skillctl" switch --dry-run
```

Execute without prompt:

```zsh
"$SKILL_HOME/bin/skillctl" switch --yes
```

### Rollback live entry points

Interactive:

```zsh
"$SKILL_HOME/bin/skillctl" rollback
```

By timestamp:

```zsh
"$SKILL_HOME/bin/skillctl" rollback YYYYMMDD-HHMMSS --yes
```

### Rebuild generated links

```zsh
"$SKILL_HOME/bin/skillctl" rebuild-views
"$SKILL_HOME/bin/skillctl" rebuild-collections
```

### Expose or hide a skill

```zsh
"$SKILL_HOME/bin/skillctl" expose ask-matt agents claude
"$SKILL_HOME/bin/skillctl" hide ask-matt claude
```

### Install from Git

```zsh
"$SKILL_HOME/bin/skillctl" install-git \
  foo-skill \
  https://github.com/someone/some-skills.git \
  skills/foo-skill \
  agents claude
```

### Update from Git

Use registry source metadata:

```zsh
"$SKILL_HOME/bin/skillctl" update-git foo-skill
```

Override source metadata for this update:

```zsh
"$SKILL_HOME/bin/skillctl" update-git \
  foo-skill \
  https://github.com/someone/some-skills.git \
  skills/foo-skill
```

### Adopt a skill installed into a view

If another installer creates a real directory under `views/agents` or `views/claude`:

```zsh
"$SKILL_HOME/bin/skillctl" adopt agents new-skill claude
"$SKILL_HOME/bin/skillctl" adopt claude new-skill agents
```

## Standard finish after changes

```zsh
cd "$SKILL_HOME"
"$SKILL_HOME/bin/skillctl" doctor
git diff
git add .
git commit -m "Describe skill change"
```
