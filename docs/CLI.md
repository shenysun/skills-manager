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
skills-manager archive old-skill
skills-manager rebuild-collections
```

Distribute targets any catalog agent id (`--agent`, repeatable). Omitting `--agent` applies to the detected set on this machine. User scope defaults to `--mode symlink`, project scope to `--mode copy`; one mode per apply.

## Agent catalog snapshot

The agent table (ids, runtime paths, detection rules) ships as a bundled snapshot extracted from [vercel-labs/skills](https://github.com/vercel-labs/skills) (MIT; attribution inside the file). `skills-manager catalog info` shows the snapshot stamp (upstream commit, date, age) and the detected agent set — the same determination `npx skills` makes with no `-a`. `skills-manager catalog refresh` re-downloads upstream, re-extracts, and stores the newer snapshot as a hub-local override at `<home>/.skills/agent-catalog.json`; doctor warns when the effective snapshot is older than 90 days.

To regenerate the checked-in snapshot during development: `npm run catalog:extract` (downloads `src/agents.ts` + `src/detect-agent.ts`, extracts, writes `src/core/catalog/agent-catalog.json`).

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
