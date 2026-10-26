import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeFileSystem } from '../../src/infra/index.js';
import {
  BUILTIN_SCANNER_ID,
  BuiltinSecurityScanner,
  SecurityScanService,
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
