import type { CatalogAgent, CatalogSnapshot, DetectionCondition, PathVariableSpec } from '../model/catalog.js';
import { SkillsManagerError } from '../../shared/errors.js';

const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const LEAF_KINDS = new Set(['env-set', 'env-value', 'env-matches', 'no-tty', 'path-exists', 'cwd-path-exists', 'cwd-package-dep', 'never']);
const REMEDIATION = 'The bundled agent catalog snapshot is broken. Reinstall the package, or run `skills-manager catalog refresh` to rebuild it from upstream.';

function fail(detail: string): never {
  throw new SkillsManagerError('catalog_invalid', `Invalid agent catalog snapshot: ${detail} ${REMEDIATION}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateVariables(variables: unknown): PathVariableSpec[] {
  if (!Array.isArray(variables)) fail('pathVariables must be an array');
  const seen = new Set<string>();
  return variables.map((raw) => {
    if (!isRecord(raw)) fail('each pathVariables entry must be an object');
    const name = raw.name;
    if (typeof name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) fail(`pathVariables entry has an invalid name: ${JSON.stringify(name)}`);
    if (seen.has(name)) fail(`pathVariables contains a duplicate name: ${name}`);
    seen.add(name);
    if (raw.envVar !== undefined && typeof raw.envVar !== 'string') fail(`pathVariables ${name}: envVar must be a string`);
    if (raw.default !== undefined && typeof raw.default !== 'string') fail(`pathVariables ${name}: default must be a string`);
    return raw as PathVariableSpec;
  });
}

function validateCondition(condition: unknown, where: string): DetectionCondition {
  if (!isRecord(condition) || typeof condition.kind !== 'string') fail(`${where} must be a detection condition object with a kind`);
  const kind = condition.kind;
  if (kind === 'any' || kind === 'all') {
    if (!Array.isArray(condition.conditions) || condition.conditions.length === 0) fail(`${where} (${kind}) needs a non-empty conditions array`);
    condition.conditions.forEach((child, index) => validateCondition(child, `${where}.${kind}[${index}]`));
    return condition as DetectionCondition;
  }
  if (!LEAF_KINDS.has(kind)) fail(`${where} has an unknown condition kind: ${kind}`);
  if (kind === 'env-set' && typeof condition.variable !== 'string') fail(`${where} (env-set) needs a string variable`);
  if (kind === 'env-value' && (typeof condition.variable !== 'string' || typeof condition.equals !== 'string')) fail(`${where} (env-value) needs string variable and equals`);
  if (kind === 'env-matches' && (typeof condition.variable !== 'string' || typeof condition.pattern !== 'string')) fail(`${where} (env-matches) needs string variable and pattern`);
  if (kind === 'path-exists' && (typeof condition.path !== 'string' || !condition.path)) fail(`${where} (path-exists) needs a non-empty path template`);
  if (kind === 'cwd-path-exists' && (typeof condition.path !== 'string' || !condition.path || condition.path.includes('..'))) fail(`${where} (cwd-path-exists) needs a non-empty relative path`);
  if (kind === 'cwd-package-dep' && typeof condition.package !== 'string') fail(`${where} (cwd-package-dep) needs a string package`);
  return condition as DetectionCondition;
}

function validateAgent(raw: unknown, index: number, knownVariables: Set<string>): CatalogAgent {
  if (!isRecord(raw)) fail(`agents[${index}] must be an object`);
  const id = raw.id;
  if (typeof id !== 'string' || !AGENT_ID_PATTERN.test(id)) fail(`agents[${index}] has an invalid id: ${JSON.stringify(id)} (expected kebab-case like "claude-code")`);
  if (typeof raw.label !== 'string' || !raw.label) fail(`agent ${id}: label must be a non-empty string`);
  if (typeof raw.skillsDir !== 'string' || !raw.skillsDir) fail(`agent ${id}: skillsDir must be a non-empty string`);
  if (raw.skillsDir.startsWith('/') || raw.skillsDir.includes('..')) fail(`agent ${id}: skillsDir must be a relative path inside the project, got ${raw.skillsDir}`);
  if (raw.globalSkillsDir !== null && typeof raw.globalSkillsDir !== 'string') fail(`agent ${id}: globalSkillsDir must be a path template or null`);
  if (typeof raw.globalSkillsDir === 'string' && !raw.globalSkillsDir) fail(`agent ${id}: globalSkillsDir must be non-empty when present`);
  if (raw.globalSkillsDir !== null && raw.globalSkillsDir !== undefined) {
    const variable = variableReference(String(raw.globalSkillsDir));
    if (variable && !knownVariables.has(variable)) fail(`agent ${id}: globalSkillsDir references unknown path variable $${variable}`);
  }
  if (raw.installProbe === undefined) fail(`agent ${id}: installProbe is required`);
  if (raw.envProbe !== null && raw.envProbe !== undefined) validateCondition(raw.envProbe, `agent ${id} envProbe`);
  const installProbe = validateCondition(raw.installProbe, `agent ${id} installProbe`);
  return { ...raw, installProbe } as CatalogAgent;
}

function variableReference(template: string): string | null {
  const match = template.match(/^\$([a-zA-Z][a-zA-Z0-9]*)(\/|$)/);
  return match ? match[1] : null;
}

/** Parse and validate raw snapshot data (JSON.parse output or injected fixture). Throws a catalog_invalid error with remediation guidance. */
export function validateCatalogSnapshot(data: unknown): CatalogSnapshot {
  if (!isRecord(data)) fail('snapshot must be a JSON object');
  if (data.version !== 1) fail(`unsupported version ${JSON.stringify(data.version)}; expected 1`);
  if (!isRecord(data.source)) fail('source stamp is missing');
  for (const field of ['repo', 'commit', 'date', 'license', 'notice'] as const) {
    if (typeof data.source[field] !== 'string' || !data.source[field]) fail(`source.${field} must be a non-empty string`);
  }
  if (!Array.isArray(data.source.files) || data.source.files.length === 0) fail('source.files must be a non-empty array');
  if (!Array.isArray(data.agents) || data.agents.length === 0) fail('agents must be a non-empty array');
  const pathVariables = validateVariables(data.pathVariables);
  const variables = new Set(pathVariables.map((variable) => variable.name));
  const seen = new Set<string>();
  const agents = data.agents.map((raw, index) => {
    const agent = validateAgent(raw, index, variables);
    if (seen.has(agent.id)) fail(`duplicate agent id: ${agent.id}`);
    seen.add(agent.id);
    return agent;
  });
  return { ...(data as CatalogSnapshot), pathVariables, agents };
}
