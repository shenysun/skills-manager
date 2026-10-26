import path from 'node:path';
import type {
  SecurityFinding,
  SecurityFindingKind,
  SecurityScanReport,
  SecurityScanSummary,
  SecuritySeverity,
  SkillHome,
} from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { SecurityScannerPort } from '../ports/security-scanner.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertSafeSkillName } from '../../shared/validation.js';

/**
 * Install/update security scan MVP (ROADMAP 「装前安全扫描」): high-signal
 * pattern scan over a skill tree. Report-only — never blocks by default.
 * Pure `scanText` is the unit under test; the builtin scanner walks the FS.
 *
 * shortcut: no third-party scanner wired yet; when SkillSpector (or another
 * winner) stabilizes, add an adapter behind SecurityScannerPort.
 */

export const BUILTIN_SCANNER_ID = 'builtin-v1';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__', '.venv', 'venv']);

const TEXT_EXT = /\.(md|sh|bash|zsh|js|mjs|cjs|ts|tsx|jsx|py|rb|pl|ps1|json|ya?ml|toml|txt|env)$/i;

type Rule = {
  kind: SecurityFindingKind;
  severity: SecuritySeverity;
  rule: string;
  pattern: RegExp;
};

const RULES: readonly Rule[] = [
  { kind: 'shell_exec', severity: 'high', rule: 'bash_c', pattern: /\b(?:bash|sh|zsh)\s+-c\b/ },
  { kind: 'shell_exec', severity: 'high', rule: 'child_process', pattern: /\bchild_process\b|\bexecSync\b|\bspawnSync\b|\bexecFileSync\b/ },
  { kind: 'shell_exec', severity: 'high', rule: 'subprocess', pattern: /\bsubprocess\.(?:run|Popen|call|check_output)\b/ },
  { kind: 'shell_exec', severity: 'warn', rule: 'eval', pattern: /\beval\s*\(|\bnew\s+Function\s*\(/ },
  { kind: 'shell_exec', severity: 'warn', rule: 'os_system', pattern: /\bos\.system\s*\(/ },

  { kind: 'network', severity: 'warn', rule: 'curl_wget', pattern: /\bcurl\b|\bwget\b/ },
  { kind: 'network', severity: 'warn', rule: 'fetch', pattern: /\bfetch\s*\(/ },
  { kind: 'network', severity: 'warn', rule: 'http_client', pattern: /\baxios\b|\bhttps?\.get\b|\brequests\.(?:get|post|put|delete|patch|head)\b|\burllib\.request\b/ },

  { kind: 'credential_path', severity: 'high', rule: 'ssh_keys', pattern: /~\/\.ssh\/|\.ssh\/id_[a-zA-Z0-9_-]+|\.aws\/credentials|\.kube\/config|\.npmrc|\.netrc/ },
  { kind: 'credential_path', severity: 'warn', rule: 'dotenv', pattern: /(?:^|[\s"'`=(])\.env(?:\.local|\.production|\.development)?(?=[\s"'`)\]},;]|$)/ },

  { kind: 'secret_like', severity: 'high', rule: 'aws_key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'secret_like', severity: 'high', rule: 'private_key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { kind: 'secret_like', severity: 'high', rule: 'openai_sk', pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { kind: 'secret_like', severity: 'warn', rule: 'api_key_assign', pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"]{8,}['"]/i },
];

/** Pure line-oriented scan used by the builtin walker and unit tests. */
export function scanText(content: string, relPath: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const seen = new Set<string>();
    for (const rule of RULES) {
      if (seen.has(rule.rule)) continue;
      if (!rule.pattern.test(line)) continue;
      seen.add(rule.rule);
      findings.push({
        kind: rule.kind,
        severity: rule.severity,
        path: relPath,
        line: i + 1,
        excerpt: line.trim().slice(0, 200),
        rule: rule.rule,
      });
    }
  }
  return findings;
}

export function summarizeFindings(findings: readonly SecurityFinding[]): SecurityScanSummary {
  const summary: SecurityScanSummary = {
    shell_exec: 0,
    network: 0,
    credential_path: 0,
    secret_like: 0,
    total: findings.length,
  };
  for (const finding of findings) summary[finding.kind] += 1;
  return summary;
}

function isScannableFile(name: string): boolean {
  if (name === 'SKILL.md' || name === 'Dockerfile') return true;
  return TEXT_EXT.test(name);
}

export class BuiltinSecurityScanner implements SecurityScannerPort {
  readonly id = BUILTIN_SCANNER_ID;

  scan(fs: FileSystemPort, skillRoot: string, skillName: string): SecurityScanReport {
    const findings: SecurityFinding[] = [];
    const walk = (dir: string, rel: string) => {
      if (fs.kind(dir) !== 'directory') return;
      for (const entry of fs.readDirectory(dir)) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        if (entry.kind === 'directory') {
          if (SKIP_DIRS.has(entry.name)) continue;
          walk(full, childRel);
          continue;
        }
        if (entry.kind !== 'file') continue;
        if (!isScannableFile(entry.name)) continue;
        // Bound the read: skip huge blobs (minified vendor dumps, etc.).
        if (fs.size(full) > 512 * 1024) continue;
        let text: string;
        try {
          text = fs.readText(full);
        } catch {
          continue;
        }
        findings.push(...scanText(text, childRel));
      }
    };
    walk(skillRoot, '');
    findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule));
    return {
      skill: skillName,
      root: skillRoot,
      scanner: this.id,
      findings,
      summary: summarizeFindings(findings),
    };
  }
}

export class SecurityScanService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly scanner: SecurityScannerPort = new BuiltinSecurityScanner(),
  ) {}

  /** Scan one hub skill by name. Missing skill → skill_missing. */
  scanSkill(skill: string): SecurityScanReport {
    assertSafeSkillName(skill);
    const root = path.join(this.home.skillsDir, skill);
    if (this.fs.kind(root) !== 'directory') {
      throw new SkillsManagerError('skill_missing', `Skill not found in hub: ${skill}`);
    }
    return this.scanner.scan(this.fs, root, skill);
  }

  scanSkills(skills: readonly string[]): SecurityScanReport[] {
    return skills.map((skill) => this.scanSkill(skill));
  }

  /** One stderr-friendly line for install/update (report-only wording). */
  formatSummaryLine(report: SecurityScanReport): string {
    const { skill, summary } = report;
    if (summary.total === 0) return `Security scan: ${skill} — clean (${report.scanner})`;
    const parts: string[] = [];
    if (summary.shell_exec) parts.push(`${summary.shell_exec} shell_exec`);
    if (summary.network) parts.push(`${summary.network} network`);
    if (summary.credential_path) parts.push(`${summary.credential_path} credential_path`);
    if (summary.secret_like) parts.push(`${summary.secret_like} secret_like`);
    const noun = summary.total === 1 ? 'finding' : 'findings';
    return `Security scan: ${skill} — ${summary.total} ${noun} (${parts.join(', ')}). Run \`skills-manager audit security ${skill}\` for details.`;
  }
}
