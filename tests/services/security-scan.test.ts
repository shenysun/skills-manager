import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeFileSystem } from '../../src/infra/index.js';
import {
  BUILTIN_SCANNER_ID,
  BuiltinSecurityScanner,
  SecurityScanService,
  formatGithubAnnotations,
  scanText,
} from '../../src/core/services/security-scan.js';
import { createSkillHome } from '../../src/core/services/skill-home-service.js';

/**
 * Install/update security scan MVP: pure scanText rules first, then the FS
 * walk over a fixture skill tree. Report-only — assertions are on findings,
 * never on side effects.
 */

describe('scanText high-signal rules', () => {
  it('flags shell exec patterns (bash -c, child_process, subprocess, eval, os.system)', () => {
    const findings = scanText(
      [
        'Run: bash -c "rm -rf /"',
        'const { execSync } = require("child_process");',
        'subprocess.run(["curl", "https://x"])',
        'eval(userInput)',
        'os.system("ls")',
      ].join('\n'),
      'scripts/run.py',
    );
    const rules = findings.map((f) => f.rule).sort();
    expect(rules).toEqual(expect.arrayContaining(['bash_c', 'child_process', 'subprocess', 'eval', 'os_system']));
    expect(findings.some((f) => f.kind === 'shell_exec' && f.severity === 'high')).toBe(true);
  });

  it('flags network calls (curl, wget, fetch, axios, http.get, requests)', () => {
    const findings = scanText(
      ['curl https://evil.example', 'wget http://x', 'await fetch(url)', 'axios.get(u)', 'http.get(u)', 'requests.post(u)'].join('\n'),
      'SKILL.md',
    );
    expect(findings.filter((f) => f.kind === 'network').length).toBeGreaterThanOrEqual(4);
  });

  it('flags credential path mentions', () => {
    const findings = scanText(
      ['cat ~/.ssh/id_rsa', 'read .aws/credentials', 'open .kube/config', 'copy .npmrc', 'see .netrc', 'source .env'].join('\n'),
      'SKILL.md',
    );
    expect(findings.filter((f) => f.kind === 'credential_path').length).toBeGreaterThanOrEqual(4);
  });

  it('flags obvious secret-looking strings', () => {
    const findings = scanText(
      [
        'key = AKIAIOSFODNN7EXAMPLE',
        '-----BEGIN RSA PRIVATE KEY-----',
        'token = sk-abcdefghijklmnopqrstuvwxyz0123456789',
        'api_key = "supersecretvalue123"',
      ].join('\n'),
      'config.env',
    );
    expect(findings.some((f) => f.kind === 'secret_like')).toBe(true);
    expect(findings.some((f) => f.rule === 'aws_key')).toBe(true);
    expect(findings.some((f) => f.rule === 'private_key')).toBe(true);
  });

  it('returns no findings for a clean skill body', () => {
    expect(scanText('# Safe skill\n\nRead the file and summarize it.\n', 'SKILL.md')).toEqual([]);
  });

  it('records relative path and 1-based line on each finding', () => {
    const findings = scanText('ok\nbash -c "x"\nok\n', 'scripts/go.sh');
    expect(findings[0]).toMatchObject({ path: 'scripts/go.sh', line: 2, kind: 'shell_exec' });
    expect(findings[0].excerpt.length).toBeGreaterThan(0);
  });
});

describe('BuiltinSecurityScanner / SecurityScanService walk', () => {
  let root: string;
  let homeRoot: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'security-scan-'));
    homeRoot = path.join(root, 'home');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeSkill(name: string, files: Record<string, string>) {
    const dir = path.join(homeRoot, 'skills', name);
    for (const [rel, body] of Object.entries(files)) {
      const full = path.join(dir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    return dir;
  }

  it('scans SKILL.md and scripts/, skips node_modules', () => {
    writeSkill('risky', {
      'SKILL.md': '---\nname: risky\ndescription: d\n---\nUse curl https://x\n',
      'scripts/run.sh': '#!/bin/sh\nbash -c "echo hi"\n',
      'node_modules/evil/index.js': 'eval("boom")\n',
    });
    const fs = createNodeFileSystem();
    const home = createSkillHome(homeRoot);
    const service = new SecurityScanService(fs, home, new BuiltinSecurityScanner());
    const report = service.scanSkill('risky');
    expect(report.scanner).toBe(BUILTIN_SCANNER_ID);
    expect(report.skill).toBe('risky');
    expect(report.findings.some((f) => f.path === 'SKILL.md' && f.kind === 'network')).toBe(true);
    expect(report.findings.some((f) => f.path === 'scripts/run.sh' && f.kind === 'shell_exec')).toBe(true);
    expect(report.findings.some((f) => f.path.includes('node_modules'))).toBe(false);
    expect(report.summary.total).toBe(report.findings.length);
    expect(report.summary.network).toBeGreaterThanOrEqual(1);
    expect(report.summary.shell_exec).toBeGreaterThanOrEqual(1);
  });

  it('reports clean for a skill with no risky patterns', () => {
    writeSkill('safe', {
      'SKILL.md': '---\nname: safe\ndescription: summarize files\n---\n# Safe\nRead and summarize.\n',
    });
    const fs = createNodeFileSystem();
    const home = createSkillHome(homeRoot);
    const service = new SecurityScanService(fs, home);
    const report = service.scanSkill('safe');
    expect(report.findings).toEqual([]);
    expect(report.summary.total).toBe(0);
  });

  it('formatSummaryLine names findings without blocking language', () => {
    writeSkill('risky', {
      'SKILL.md': '---\nname: risky\ndescription: d\n---\ncurl https://x\n',
    });
    const fs = createNodeFileSystem();
    const home = createSkillHome(homeRoot);
    const service = new SecurityScanService(fs, home);
    const line = service.formatSummaryLine(service.scanSkill('risky'));
    expect(line).toMatch(/risky/);
    expect(line).toMatch(/finding/);
    expect(line.toLowerCase()).not.toMatch(/block|denied|refused/);
  });
});

describe('SecurityScanService --strict gate helpers', () => {
  let root: string;
  let homeRoot: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'security-strict-'));
    homeRoot = path.join(root, 'home');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeSkill(name: string, body: string) {
    const dir = path.join(homeRoot, 'skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), body);
  }

  it('countHighFindings / failsStrict trip only on high severity', () => {
    writeSkill('warn-only', '---\nname: warn-only\ndescription: d\n---\ncurl https://example.com\n');
    writeSkill('high-risk', '---\nname: high-risk\ndescription: d\n---\nbash -c "echo x"\n');
    writeSkill('clean', '---\nname: clean\ndescription: d\n---\n# Safe\n');
    const fs = createNodeFileSystem();
    const home = createSkillHome(homeRoot);
    const service = new SecurityScanService(fs, home);
    const warnOnly = service.scanSkill('warn-only');
    const high = service.scanSkill('high-risk');
    const clean = service.scanSkill('clean');

    expect(warnOnly.findings.every((f) => f.severity !== 'high')).toBe(true);
    expect(service.countHighFindings([warnOnly])).toBe(0);
    expect(service.failsStrict([warnOnly])).toBe(false);

    expect(service.countHighFindings([high])).toBeGreaterThan(0);
    expect(service.failsStrict([high])).toBe(true);

    expect(service.failsStrict([clean, warnOnly])).toBe(false);
    expect(service.failsStrict([clean, warnOnly, high])).toBe(true);
    expect(service.countHighFindings([high, high])).toBe(service.countHighFindings([high]) * 2);
  });
});

describe('formatGithubAnnotations', () => {
  it('emits error/warning/notice lines with hub-relative skills/ paths', () => {
    const out = formatGithubAnnotations([
      {
        skill: 'risky',
        root: '/hub/skills/risky',
        scanner: BUILTIN_SCANNER_ID,
        findings: [
          { kind: 'shell_exec', severity: 'high', path: 'SKILL.md', line: 4, excerpt: 'bash -c "x"', rule: 'bash_c' },
          { kind: 'network', severity: 'warn', path: 'scripts/fetch.js', line: 2, excerpt: 'curl https://x', rule: 'curl_wget' },
          { kind: 'secret_like', severity: 'info', path: 'NOTES.md', line: 1, excerpt: 'maybe later', rule: 'api_key_assign' },
        ],
        summary: { shell_exec: 1, network: 1, credential_path: 0, secret_like: 1, total: 3 },
      },
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('::error file=skills/risky/SKILL.md,line=4,title=bash_c::shell_exec: bash -c "x"');
    expect(lines[1]).toBe('::warning file=skills/risky/scripts/fetch.js,line=2,title=curl_wget::network: curl https://x');
    expect(lines[2]).toBe('::notice file=skills/risky/NOTES.md,line=1,title=api_key_assign::secret_like: maybe later');
  });

  it('returns empty string when there are no findings', () => {
    expect(formatGithubAnnotations([])).toBe('');
    expect(
      formatGithubAnnotations([
        {
          skill: 'safe',
          root: '/hub/skills/safe',
          scanner: BUILTIN_SCANNER_ID,
          findings: [],
          summary: { shell_exec: 0, network: 0, credential_path: 0, secret_like: 0, total: 0 },
        },
      ]),
    ).toBe('');
  });

  it('escapes % and newlines in workflow-command values', () => {
    const out = formatGithubAnnotations([
      {
        skill: 'odd',
        root: '/hub/skills/odd',
        scanner: BUILTIN_SCANNER_ID,
        findings: [
          {
            kind: 'shell_exec',
            severity: 'high',
            path: 'SKILL.md',
            line: 1,
            excerpt: '100% done\nok',
            rule: 'bash_c',
          },
        ],
        summary: { shell_exec: 1, network: 0, credential_path: 0, secret_like: 0, total: 1 },
      },
    ]);
    expect(out).toContain('100%25 done%0Aok');
  });
});
