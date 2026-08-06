export const CONSUMERS = ['agents', 'claude'] as const;
export type Consumer = (typeof CONSUMERS)[number];

export type SkillEntry = {
  path?: string;
  title?: string;
  category?: string;
  tags?: string[];
  consumers?: Consumer[];
  source?: {
    type?: 'local' | 'git' | 'github' | string;
    url?: string | null;
    subpath?: string | null;
    ref?: string | null;
    upstream_commit?: string | null;
    imported_from?: string[];
  };
  update_policy?: string;
  description?: string;
  [key: string]: unknown;
};

export type Registry = { skills: Record<string, SkillEntry> };

export type DiscoveredSkill = {
  name: string;
  title: string;
  description: string;
  subpath: string;
  absoluteDir: string;
};

export type SourceSpec = {
  repoUrl: string;
  baseSubpath?: string;
  ref?: string;
  isLocal: boolean;
  treeRest?: string;
};

export type SourceInfo = SourceSpec & {
  repoDir: string;
  commit: string | null;
};

export function isConsumer(value: string): value is Consumer {
  return (CONSUMERS as readonly string[]).includes(value);
}

export function parseConsumers(values: string[] | undefined, fallback?: Consumer[]): Consumer[] {
  const raw = values && values.length > 0 ? values : fallback;
  if (!raw || raw.length === 0) throw new Error('至少需要一个消费者：agents 或 claude');
  const invalid = raw.filter((value) => !isConsumer(value));
  if (invalid.length > 0) throw new Error(`未知消费者：${invalid.join(', ')}。可选值：${CONSUMERS.join(', ')}`);
  return [...new Set(raw)] as Consumer[];
}
