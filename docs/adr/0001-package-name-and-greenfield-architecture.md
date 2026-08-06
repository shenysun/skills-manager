# ADR-0001: Package name and greenfield architecture posture

## Status

Accepted

## Context

The project started as a local skill repository plus an evolving `skills` CLI/admin prototype. The next phase is a publishable npm package with a maintainable local web admin. Continuing to accumulate code in the prototype would make the architecture harder to reason about and harder to publish safely.

## Decision

- Publish the npm package as `@shenysun/skills-manager`.
- Use `skills-manager` as the executable command name to match the npm package identity.
- Treat the package implementation as a new product architecture, not an incremental patch on the current prototype.
- Use clean boundaries between:
  - core domain/application services,
  - CLI adapter,
  - Fastify dashboard HTTP adapter,
  - Vue dashboard frontend,
  - persistence/filesystem adapters.

## Consequences

- Existing working code may be reused only after it fits the new module boundaries.
- The dashboard UI should be redesigned before implementation.
- Build and packaging should be designed for npm distribution from the start.
- The local skill repository layout remains supported, but package code should not assume this repo path as the only possible `SKILL_HOME`.

## Follow-up naming decisions

- Use `dashboard` naming for the local web UI and code paths. Avoid `admin` / `admin-web` in the greenfield implementation.
- Launch command: `skills-manager dashboard`.
- Default skill home when no explicit home is supplied: `~/.skills-manager`.
