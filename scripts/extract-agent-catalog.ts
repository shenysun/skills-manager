/**
 * One-shot catalog snapshot extractor (build-time action; see ADR-0004).
 * Downloads upstream vercel-labs/skills sources, extracts the agent table
 * as data, and writes src/core/catalog/agent-catalog.json. Repeatable:
 * `npm run catalog:extract`. This is the same extraction `catalog refresh`
 * performs at runtime, minus the download target.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractCatalogSnapshot } from '../src/core/catalog/extract.js';

const RAW_BASE = 'https://raw.githubusercontent.com/vercel-labs/skills/main';
const COMMIT_API = 'https://api.github.com/repos/vercel-labs/skills/commits?path=src/agents.ts&per_page=1';

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

const target = path.join(import.meta.dirname, '..', 'src', 'core', 'catalog', 'agent-catalog.json');

const [agentsTs, detectAgentTs, commitJson] = await Promise.all([
  fetchText(`${RAW_BASE}/src/agents.ts`),
  fetchText(`${RAW_BASE}/src/detect-agent.ts`),
  fetchText(COMMIT_API),
]);
const commit = JSON.parse(commitJson)[0].sha as string;
const date = JSON.parse(commitJson)[0].commit.committer.date as string;

const snapshot = extractCatalogSnapshot({ agentsTs, detectAgentTs, commit, date });
writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Wrote ${snapshot.agents.length} agents from ${commit.slice(0, 10)} (${date}) to ${path.relative(process.cwd(), target)}`);
