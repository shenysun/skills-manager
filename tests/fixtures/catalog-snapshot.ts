import type { CatalogSnapshot } from '../../src/core/model/catalog.js';

/**
 * Minimal catalog fixture mirroring the shapes that matter downstream:
 * a shared-path family (zed/warp on ~/.agents/skills), a shared project
 * family (.agents/skills), a project-only agent (eve), and env probes.
 * Returned fresh on every call so tests can mutate their copy freely.
 */
export function fixtureSnapshot(): CatalogSnapshot {
  return {
    version: 1,
    source: {
      repo: 'vercel-labs/skills',
      files: ['src/agents.ts'],
      commit: 'fixture-commit',
      date: '2026-08-01T00:00:00Z',
      license: 'MIT',
      notice: 'Fixture only; not upstream data.',
    },
    pathVariables: [
      { name: 'xdgConfig', envVar: 'XDG_CONFIG_HOME', default: '~/.config' },
      { name: 'codexHome', envVar: 'CODEX_HOME', default: '~/.codex' },
    ],
    agents: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        skillsDir: '.claude/skills',
        globalSkillsDir: '~/.claude/skills',
        installProbe: { kind: 'path-exists', path: '~/.claude' },
        envProbe: { kind: 'any', conditions: [{ kind: 'env-set', variable: 'CLAUDECODE' }, { kind: 'env-set', variable: 'CLAUDE_CODE' }] },
      },
      {
        id: 'codex',
        label: 'Codex',
        skillsDir: '.agents/skills',
        globalSkillsDir: '$codexHome/skills',
        installProbe: { kind: 'any', conditions: [{ kind: 'path-exists', path: '$codexHome' }, { kind: 'path-exists', path: '/etc/codex' }] },
        envProbe: { kind: 'any', conditions: [{ kind: 'env-set', variable: 'CODEX_SANDBOX' }, { kind: 'env-set', variable: 'CODEX_CI' }] },
      },
      {
        id: 'cursor',
        label: 'Cursor',
        skillsDir: '.agents/skills',
        globalSkillsDir: '~/.cursor/skills',
        installProbe: { kind: 'path-exists', path: '~/.cursor' },
        envProbe: {
          kind: 'any',
          conditions: [{ kind: 'env-set', variable: 'CURSOR_AGENT' }, { kind: 'env-value', variable: 'CURSOR_EXTENSION_HOST_ROLE', equals: 'agent-exec' }],
        },
      },
      {
        id: 'opencode',
        label: 'OpenCode',
        skillsDir: '.agents/skills',
        globalSkillsDir: '$xdgConfig/opencode/skills',
        installProbe: { kind: 'path-exists', path: '$xdgConfig/opencode' },
        envProbe: null,
      },
      {
        id: 'zed',
        label: 'Zed',
        skillsDir: '.agents/skills',
        globalSkillsDir: '~/.agents/skills',
        installProbe: { kind: 'path-exists', path: '$xdgConfig/zed' },
        envProbe: null,
      },
      {
        id: 'warp',
        label: 'Warp',
        skillsDir: '.agents/skills',
        globalSkillsDir: '~/.agents/skills',
        installProbe: { kind: 'path-exists', path: '~/.warp' },
        envProbe: null,
      },
      {
        id: 'universal',
        label: 'Universal',
        skillsDir: '.agents/skills',
        globalSkillsDir: '$xdgConfig/agents/skills',
        installProbe: { kind: 'never' },
        envProbe: { kind: 'path-exists', path: '/opt/.devin' },
      },
      {
        id: 'eve',
        label: 'Eve',
        skillsDir: 'agent/skills',
        globalSkillsDir: null,
        installProbe: { kind: 'all', conditions: [{ kind: 'cwd-path-exists', path: 'agent' }, { kind: 'cwd-package-dep', package: 'eve' }] },
        envProbe: null,
      },
    ],
  };
}
