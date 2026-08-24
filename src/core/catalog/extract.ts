import type { CatalogAgent, CatalogSnapshot, DetectionCondition, PathVariableSpec } from '../model/catalog.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { validateCatalogSnapshot } from './validate-snapshot.js';

/**
 * Build a catalog snapshot from vercel-labs/skills upstream sources.
 * This is the one-time build-step extractor behind both the checked-in
 * snapshot and `catalog refresh`; it translates upstream code shapes into
 * data and refuses (loudly) anything it cannot translate mechanically.
 */

export type UpstreamSources = {
  agentsTs: string;
  detectAgentTs: string;
  commit: string;
  date: string;
};

const NOTICE =
  'Agent table extracted from vercel-labs/skills (src/agents.ts, src/detect-agent.ts, mirroring @vercel/detect-agent runtime detection). All MIT. Copyright (c) 2026 Vercel, Inc.';

/**
 * Runtime env-detection rules mirrored from @vercel/detect-agent's
 * determineAgent() (dist/index.js). Its agents.json is a spec document, not
 * runtime truth — the shipped if-chain differs (no CODEX_SANDBOX_NETWORK_
 * DISABLED, no OPENCODE, no ANTIGRAVITY_CLI_ALIAS), so we mirror the code.
 * The AI_AGENT pass-through override is intentionally not modelled.
 */
const DETERMINE_AGENT_RULES: Array<{ name: string; condition: DetectionCondition }> = [
  { name: 'cursor', condition: { kind: 'env-set', variable: 'CURSOR_TRACE_ID' } },
  {
    name: 'cursor-cli',
    condition: {
      kind: 'any',
      conditions: [{ kind: 'env-set', variable: 'CURSOR_AGENT' }, { kind: 'env-value', variable: 'CURSOR_EXTENSION_HOST_ROLE', equals: 'agent-exec' }],
    },
  },
  { name: 'gemini', condition: { kind: 'env-set', variable: 'GEMINI_CLI' } },
  {
    name: 'codex',
    condition: { kind: 'any', conditions: [{ kind: 'env-set', variable: 'CODEX_SANDBOX' }, { kind: 'env-set', variable: 'CODEX_CI' }, { kind: 'env-set', variable: 'CODEX_THREAD_ID' }] },
  },
  { name: 'antigravity', condition: { kind: 'env-set', variable: 'ANTIGRAVITY_AGENT' } },
  { name: 'augment-cli', condition: { kind: 'env-set', variable: 'AUGMENT_AGENT' } },
  { name: 'opencode', condition: { kind: 'env-set', variable: 'OPENCODE_CLIENT' } },
  { name: 'claude', condition: { kind: 'any', conditions: [{ kind: 'env-set', variable: 'CLAUDECODE' }, { kind: 'env-set', variable: 'CLAUDE_CODE' }] } },
  {
    name: 'cowork',
    condition: { kind: 'all', conditions: [{ kind: 'env-set', variable: 'CLAUDE_CODE_IS_COWORK' }, { kind: 'any', conditions: [{ kind: 'env-set', variable: 'CLAUDECODE' }, { kind: 'env-set', variable: 'CLAUDE_CODE' }] }] },
  },
  { name: 'replit', condition: { kind: 'env-set', variable: 'REPL_ID' } },
  {
    name: 'github-copilot',
    condition: { kind: 'any', conditions: [{ kind: 'env-set', variable: 'COPILOT_MODEL' }, { kind: 'env-set', variable: 'COPILOT_ALLOW_ALL' }, { kind: 'env-set', variable: 'COPILOT_GITHUB_TOKEN' }] },
  },
  { name: 'devin', condition: { kind: 'path-exists', path: '/opt/.devin' } },
];

const INSTALL_HELPERS: Record<string, DetectionCondition> = {
  'isZCodeInstalled()': {
    kind: 'any',
    conditions: [{ kind: 'path-exists', path: '~/.zcode' }, { kind: 'path-exists', path: '/Applications/ZCode.app' }],
  },
  'isKimchiInstalled()': { kind: 'path-exists', path: '~/.config/kimchi' },
  'isMiniMaxCodeInstalled()': {
    kind: 'any',
    conditions: [{ kind: 'path-exists', path: '~/.minimax' }, { kind: 'path-exists', path: '/Applications/MiniMax Code.app' }],
  },
  'isPositAssistantInstalled()': {
    kind: 'any',
    conditions: [{ kind: 'path-exists', path: '~/.posit/assistant' }, { kind: 'path-exists', path: '~/.positai' }],
  },
};

function unsupported(agentId: string, detail: string): never {
  throw new SkillsManagerError('catalog_extract_unsupported', `Cannot translate upstream shape for agent "${agentId}": ${detail}. The upstream source layout changed; update the extractor.`);
}

/** Split on a top-level operator, ignoring parentheses and string literals. */
function splitTopLevel(expression: string, operator: string): string[] | null {
  let depth = 0;
  let quote = false;
  const parts: string[] = [];
  let current = '';
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (quote) {
      current += char;
      if (char === "'") quote = false;
      continue;
    }
    if (char === "'") {
      quote = true;
      current += char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0 && expression.startsWith(operator, index)) {
      parts.push(current);
      current = '';
      index += operator.length - 1;
      continue;
    }
    current += char;
  }
  if (parts.length === 0) return null;
  parts.push(current);
  return parts.every((part) => part.trim()) ? parts : null;
}

function unparenthesize(expression: string) {
  let value = expression.trim();
  while (value.startsWith('(') && value.endsWith(')')) {
    // Strip the wrapping parens only when they enclose the WHOLE expression.
    let depth = 0;
    let quote = false;
    let closingAt = -1;
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (quote) {
        if (char === "'") quote = false;
        continue;
      }
      if (char === "'") {
        quote = true;
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          closingAt = index;
          break;
        }
      }
    }
    if (closingAt !== value.length - 1) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

function stringArgs(call: string): string[] {
  return [...call.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((match) => match[1]);
}

function translateExistsArg(arg: string, agentId: string): DetectionCondition {
  const trimmed = arg.trim();
  const joinMatch = trimmed.match(/^join\((.+)\)$/s);
  if (joinMatch) {
    const first = joinMatch[1].split(',')[0].trim();
    const rest = stringArgs(joinMatch[1]);
    const tail = rest.join('/');
    if (first === 'home') return { kind: 'path-exists', path: tail ? `~/${tail}` : '~' };
    if (first === 'process.cwd()' || first === 'cwd') return { kind: 'cwd-path-exists', path: tail };
    if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(first)) return { kind: 'path-exists', path: tail ? `$${first}/${tail}` : `$${first}` };
    return unsupported(agentId, `unrecognized join() base "${first}"`);
  }
  if (trimmed === 'home') return { kind: 'path-exists', path: '~' };
  if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(trimmed)) return { kind: 'path-exists', path: `$${trimmed}` };
  if (/^'/.test(trimmed)) return { kind: 'path-exists', path: stringArgs(trimmed)[0] };
  return unsupported(agentId, `unrecognized existsSync() argument "${trimmed}"`);
}

function translateExpression(expression: string, agentId: string): DetectionCondition {
  const value = unparenthesize(expression);
  if (value === 'false') return { kind: 'never' };
  const orParts = splitTopLevel(value, '||');
  if (orParts) return { kind: 'any', conditions: orParts.map((part) => translateExpression(part, agentId)) };
  const andParts = splitTopLevel(value, '&&');
  if (andParts) {
    // `!!variable && existsSync(join(variable, ...))` guards an optional path
    // variable; the guard is redundant because an unset variable resolves to
    // null and the path-exists condition simply cannot match.
    const meaningful = andParts.filter((part) => !/^!![a-zA-Z][a-zA-Z0-9]*$/.test(part.trim()));
    if (meaningful.length === 0) return unsupported(agentId, `expression is only variable guards: ${value}`);
    const conditions = meaningful.map((part) => translateExpression(part, agentId));
    return conditions.length === 1 ? conditions[0] : { kind: 'all', conditions };
  }
  if (/^is\w+Installed\(\)$/.test(value)) {
    const helper = INSTALL_HELPERS[value];
    if (helper) return helper;
    return unsupported(agentId, `unknown installed-helper "${value}"`);
  }
  const packageDep = value.match(/^packageJsonHasDependency\(join\([^)]*\),\s*'([^']+)'\)$/);
  if (packageDep) return { kind: 'cwd-package-dep', package: packageDep[1] };
  const exists = value.match(/^existsSync\((.+)\)$/s);
  if (exists) return translateExistsArg(exists[1], agentId);
  return unsupported(agentId, `unrecognized expression "${value}"`);
}

function translateDetectInstalled(detectBody: string, agentId: string): DetectionCondition {
  const returns = [...detectBody.matchAll(/return\s+([\s\S]*?);/g)].map((match) => match[1].replace(/\s+/g, ' ').trim());
  if (returns.length === 0) return unsupported(agentId, 'detectInstalled has no return statement');
  return translateExpression(returns.join(' && '), agentId);
}

function parsePathVariables(agentsTs: string): PathVariableSpec[] {
  const variables: PathVariableSpec[] = [];
  for (const line of agentsTs.split('\n')) {
    const trimmed = line.trim();
    const envWithFallback = trimmed.match(/^const (\w+) = process\.env\.(\w+)\?\.trim\(\) \|\| join\(home, '([^']+)'\);$/);
    if (envWithFallback) {
      variables.push({ name: envWithFallback[1], envVar: envWithFallback[2], default: `~/${envWithFallback[3]}` });
      continue;
    }
    const envOnly = trimmed.match(/^const (\w+) = process\.env\.(\w+)\?\.trim\(\);$/);
    if (envOnly) {
      variables.push({ name: envOnly[1], envVar: envOnly[2] });
      continue;
    }
    const xdg = trimmed.match(/^const (\w+) = xdgConfig \?\? join\(home, '([^']+)'\);$/);
    if (xdg) variables.push({ name: xdg[1], envVar: 'XDG_CONFIG_HOME', default: `~/${xdg[2]}` });
  }
  return variables;
}

function balancedBlock(source: string, openIndex: number): string {
  let depth = 0;
  let quote = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "'") quote = false;
      continue;
    }
    if (char === "'") {
      quote = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  throw new SkillsManagerError('catalog_extract_unsupported', 'Unbalanced braces in upstream source');
}

/** Remove line and block comments; apostrophes inside them would otherwise break quote-aware brace balancing. */
function stripComments(source: string): string {
  let result = '';
  let quote = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      result += char;
      if (char === "'") quote = false;
      continue;
    }
    if (char === "'") {
      quote = true;
      result += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      result += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 1;
      continue;
    }
    result += char;
  }
  return result;
}

function parseAgentsRecord(agentsTs: string) {
  const source = stripComments(agentsTs);
  const marker = source.indexOf('export const agents');
  if (marker === -1) throw new SkillsManagerError('catalog_extract_unsupported', 'agents record not found in upstream agents.ts');
  const openBrace = source.indexOf('{', marker);
  const body = balancedBlock(source, openBrace);
  const members: Array<{ id: string; body: string }> = [];
  let index = 0;
  while (index < body.length) {
    const head = body.slice(index).match(/^\s*,?\s*(?:'([^']+)'|([a-zA-Z-]+)):\s*\{/);
    if (!head) break;
    const id = head[1] || head[2];
    const memberStart = index + (head[0].length - 1);
    const memberBody = balancedBlock(body, memberStart);
    members.push({ id, body: memberBody });
    index = memberStart + memberBody.length + 2;
  }
  return members;
}

function translateGlobalSkillsDir(field: string, agentId: string): string | null {
  const value = field.trim();
  if (value === 'undefined' || value === '') return null;
  if (value === 'getOpenClawGlobalSkillsDir()') return '~/.openclaw/skills';
  const joinMatch = value.match(/^join\((.+)\)$/s);
  if (!joinMatch) return unsupported(agentId, `unrecognized globalSkillsDir "${value}"`);
  const first = joinMatch[1].split(',')[0].trim();
  const tail = stringArgs(joinMatch[1]).join('/');
  if (first === 'home') return `~/${tail}`;
  if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(first)) return `$${first}/${tail}`;
  return unsupported(agentId, `unrecognized globalSkillsDir base "${first}"`);
}

function readField(memberBody: string, field: string): string | null {
  const match = memberBody.match(new RegExp(`^\\s*${field}:\\s*([\\s\\S]*?),\\n`, 'm'));
  if (!match) return null;
  return match[1].trim();
}

function parseEnvProbes(detectAgentTs: string): Map<string, DetectionCondition> {
  const mappingBlock = detectAgentTs.match(/const agentNameToType[^=]*=\s*\{([\s\S]*?)\};/);
  if (!mappingBlock) throw new SkillsManagerError('catalog_extract_unsupported', 'agentNameToType mapping not found in upstream detect-agent.ts');
  const nameToType = new Map<string, string>();
  for (const match of mappingBlock[1].matchAll(/(?:'([^']+)'|([a-zA-Z-]+))\s*:\s*'([^']+)'/g)) {
    nameToType.set(match[1] || match[2], match[3]);
  }
  const rulesByName = new Map(DETERMINE_AGENT_RULES.map((rule) => [rule.name, rule]));

  // Upstream refines cursor/cursor-cli hits down to strong signals only
  // (weak CURSOR_TRACE_ID is present in plain Cursor terminals); replicate
  // that by using the cursor-cli rule for the cursor family.
  const refinesCursor = detectAgentTs.includes('hasStrongCursorAgentSignal');
  const probes = new Map<string, DetectionCondition[]>();
  for (const [name, type] of nameToType) {
    let rule = rulesByName.get(name);
    if (!rule) continue;
    if (refinesCursor && (name === 'cursor' || name === 'cursor-cli')) rule = rulesByName.get('cursor-cli');
    if (!rule) continue;
    const existing = probes.get(type) || [];
    const serialized = JSON.stringify(rule.condition);
    if (!existing.some((condition) => JSON.stringify(condition) === serialized)) probes.set(type, [...existing, rule.condition]);
  }
  const merged = new Map<string, DetectionCondition>();
  for (const [type, conditions] of probes) {
    merged.set(type, conditions.length === 1 ? conditions[0] : { kind: 'any', conditions });
  }
  return merged;
}

export function extractCatalogSnapshot(sources: UpstreamSources): CatalogSnapshot {
  const pathVariables = parsePathVariables(sources.agentsTs);
  const envProbes = parseEnvProbes(sources.detectAgentTs);
  const agents: CatalogAgent[] = parseAgentsRecord(sources.agentsTs).map(({ id, body }) => {
    const label = readField(body, 'displayName')?.replace(/^'|'$/g, '');
    const skillsDir = readField(body, 'skillsDir')?.replace(/^'|'$/g, '');
    if (!label || !skillsDir) unsupported(id, 'displayName or skillsDir missing');
    const globalSkillsDir = translateGlobalSkillsDir(readField(body, 'globalSkillsDir') || 'undefined', id);
    const detectMatch = body.match(/detectInstalled:\s*async\s*\(\)\s*=>\s*/);
    if (!detectMatch) unsupported(id, 'detectInstalled not found');
    const afterArrow = detectMatch.index! + detectMatch[0].length;
    const isBlock = body[afterArrow] === '{';
    const installProbe = isBlock
      ? translateDetectInstalled(balancedBlock(body, afterArrow), id)
      : translateExpression(body.slice(afterArrow).replace(/,\s*$/, ''), id);
    return {
      id,
      label: label as string,
      skillsDir: skillsDir as string,
      globalSkillsDir,
      installProbe,
      envProbe: envProbes.get(id) || null,
    };
  });
  return validateCatalogSnapshot({
    version: 1,
    source: {
      repo: 'vercel-labs/skills',
      files: ['src/agents.ts', 'src/detect-agent.ts'],
      commit: sources.commit,
      date: sources.date,
      license: 'MIT',
      notice: NOTICE,
    },
    pathVariables,
    agents,
  });
}
