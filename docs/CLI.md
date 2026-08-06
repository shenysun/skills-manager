# Skills Manager CLI

`@shenysun/skills-manager` provides the `skills-manager` executable for a local-first skill home.

## Skill home resolution

Priority:

1. `--home <path>`
2. `SKILL_HOME`
3. the current working directory when it already contains `skills/`, `views/`, `collections/`, and `registry.yaml`
4. `~/.skills-manager`, which is initialized automatically

Initialization creates `skills/`, `views/`, `collections/`, `registry.yaml`, and the parent directory for `.skills/activity.jsonl`.

## Commands

```sh
skills-manager dashboard --home ./my-skill-home
skills-manager doctor --home ./my-skill-home
skills-manager list --home ./my-skill-home
skills-manager add <source> --all --consumer agents --consumer claude --yes
skills-manager update --plan
skills-manager update --skill my-skill
skills-manager update --source '<source-key>'
skills-manager expose agents my-skill
skills-manager hide claude my-skill
skills-manager archive old-skill
skills-manager adopt agents skill-installed-in-view
skills-manager rebuild-views
skills-manager rebuild-collections
```

`<source>` can be a GitHub shorthand (`owner/repo`), Git URL, GitHub tree URL, or local path.

## Dashboard

```sh
skills-manager dashboard --home ~/.skills-manager
skills-manager dashboard --no-open
```

The dashboard serves a local Vue/Vite UI backed by Fastify routes. Mutating dashboard operations write activity records to `.skills/activity.jsonl` and leave disk changes visible for `git diff`.

## Development

```sh
npm install
npm run build
npm run smoke:core
npm run smoke:cli
npm run smoke:api
npm run smoke:package
```

For publish checks:

```sh
npm pack --dry-run
npm pack
npm install -g ./shenysun-skills-manager-*.tgz
skills-manager doctor --home /tmp/skills-home
```
