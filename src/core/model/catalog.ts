/**
 * Catalog snapshot types. The snapshot is the vercel-labs/skills agent table
 * extracted as data (see ADR-0004): agent ids, runtime paths, and detection
 * rules all travel inside it; code never hard-codes agent lists.
 */

export type PathVariableSpec = {
  name: string;
  /** Environment variable that overrides the default template. */
  envVar?: string;
  /** Default template; may start with `~` (user home). Absent = no default. */
  default?: string;
};

export type DetectionCondition =
  | { kind: 'env-set'; variable: string }
  | { kind: 'env-value'; variable: string; equals: string }
  | { kind: 'env-matches'; variable: string; pattern: string }
  | { kind: 'no-tty' }
  | { kind: 'path-exists'; path: string }
  | { kind: 'cwd-path-exists'; path: string }
  | { kind: 'cwd-package-dep'; package: string }
  | { kind: 'never' }
  | { kind: 'any'; conditions: DetectionCondition[] }
  | { kind: 'all'; conditions: DetectionCondition[] };

export type CatalogAgent = {
  id: string;
  label: string;
  /** Runtime skill directory relative to a project root. */
  skillsDir: string;
  /** Absolute path template for the global runtime dir; null = project-only agent. */
  globalSkillsDir: string | null;
  /** Installed-agent scan rule (upstream detectInstalled). */
  installProbe: DetectionCondition;
  /** AI-environment detection rule (upstream determineAgent, mapped to catalog ids); null = none. */
  envProbe: DetectionCondition | null;
};

export type CatalogSourceStamp = {
  repo: string;
  files: string[];
  commit: string;
  date: string;
  license: string;
  notice: string;
};

export type CatalogSnapshot = {
  version: 1;
  source: CatalogSourceStamp;
  pathVariables: PathVariableSpec[];
  agents: CatalogAgent[];
};
