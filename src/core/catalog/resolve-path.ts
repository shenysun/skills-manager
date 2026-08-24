import type { PathVariableSpec } from '../model/catalog.js';

export type TemplateContext = {
  variables: readonly PathVariableSpec[];
  homeDir: string;
  env: Record<string, string | undefined>;
};

/**
 * Resolve a snapshot path template to an absolute path.
 * `~` expands to homeDir; `$name` expands via the path-variables table
 * (env override first, then the declared default). A variable with neither
 * resolves to null — callers treat that as "rule cannot match here".
 */
export function resolveCatalogTemplate(template: string, context: TemplateContext): string | null {
  if (template.startsWith('$')) {
    const match = template.match(/^\$([a-zA-Z][a-zA-Z0-9]*)(.*)$/);
    if (!match) return null;
    const [, name, rest] = match;
    const spec = context.variables.find((variable) => variable.name === name);
    if (!spec) return null;
    const override = spec.envVar ? context.env[spec.envVar]?.trim() : undefined;
    const base = override || spec.default;
    if (!base) return null;
    const resolved = resolveCatalogTemplate(base, context);
    return resolved === null ? null : resolved + rest;
  }
  if (template === '~') return context.homeDir;
  if (template.startsWith('~/')) return context.homeDir + template.slice(1);
  return template;
}
