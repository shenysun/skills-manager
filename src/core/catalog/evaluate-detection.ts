import type { CatalogSnapshot, DetectionCondition, PathVariableSpec } from '../model/catalog.js';
import { resolveCatalogTemplate } from './resolve-path.js';

export type DetectionContext = {
  variables: readonly PathVariableSpec[];
  env: Record<string, string | undefined>;
  homeDir: string;
  cwd: string;
  /** Absolute-path existence (file or directory). */
  pathExists(absolute: string): boolean;
  /** Relative-path existence inside cwd. */
  cwdPathExists(relative: string): boolean;
  /** Whether cwd's package.json declares the given dependency. */
  packageHasDependency(name: string): boolean;
  /** Whether stdout is attached to a terminal (upstream no_tty rule). */
  isTty: boolean;
};

/** Evaluate one detection condition against injected context. Pure: data in, boolean out. */
export function evaluateCondition(condition: DetectionCondition, context: DetectionContext): boolean {
  switch (condition.kind) {
    case 'env-set':
      return Boolean(context.env[condition.variable]?.trim());
    case 'env-value':
      return context.env[condition.variable] === condition.equals;
    case 'env-matches':
      return context.env[condition.variable] !== undefined && new RegExp(condition.pattern).test(context.env[condition.variable] as string);
    case 'no-tty':
      return !context.isTty;
    case 'path-exists': {
      const resolved = resolveCatalogTemplate(condition.path, context);
      return resolved !== null && context.pathExists(resolved);
    }
    case 'cwd-path-exists':
      return context.cwdPathExists(condition.path);
    case 'cwd-package-dep':
      return context.packageHasDependency(condition.package);
    case 'never':
      return false;
    case 'any':
      return condition.conditions.some((child) => evaluateCondition(child, context));
    case 'all':
      return condition.conditions.every((child) => evaluateCondition(child, context));
  }
}

/**
 * The detected set: agents whose install probe or env probe matches this
 * machine — the same rules over the same data `npx skills` uses with no -a.
 */
export function detectAgents(snapshot: CatalogSnapshot, context: DetectionContext): string[] {
  const hit = snapshot.agents.filter((agent) => {
    if (evaluateCondition(agent.installProbe, context)) return true;
    return agent.envProbe !== null && evaluateCondition(agent.envProbe, context);
  });
  return hit.map((agent) => agent.id).sort();
}
