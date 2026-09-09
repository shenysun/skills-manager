import { createRequire } from 'node:module';
import type { Command } from 'commander';
import { createRuntimeServices, projectRootFromImportMeta } from '../infra/runtime.js';
import { MANAGER_SKILL_NAME, type ManagerSkillBundle } from '../core/index.js';
import { normalizeGitSourceUrl } from '../core/services/source-service.js';
import { SkillsManagerError } from '../shared/errors.js';
import { multiSelect, type SelectOption } from './bootstrap-prompt.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string; repository?: { url?: string } };
const projectRoot = projectRootFromImportMeta(import.meta.url);

const STARTER_PROMPT_ZH = '帮我看看我的 skills：有哪些、装到哪些 agent 了、有没有能更新的';
const STARTER_PROMPT_EN = 'Take stock of my skills: what I have, which agents they are wired into, and what has updates';
const IMPORT_PROMPT_ZH = '帮我把现有的 skills 导入 skills-manager 并整理好来源';

export function managerSkillBundle(): ManagerSkillBundle {
  const raw = pkg.repository?.url || 'shenysun/skills-manager';
  return { root: projectRoot, version: pkg.version, repoUrl: normalizeGitSourceUrl(raw.replace(/^git\+/, '')) };
}

export type BootstrapOptions = {
  agent?: string[];
  force?: boolean;
};

/**
 * The one-time setup, and the product's front door (ADR-0014): create the hub,
 * seed the manager skill from the bundled copy, mount it to the chosen agents,
 * print the starter prompt. It imports nothing — importing existing runtime
 * skills is a conversational act for later, through the manager skill itself.
 */
export async function runBootstrap(opts: BootstrapOptions, cmd: Command): Promise<void> {
  const globalOpts = (cmd.optsWithGlobals() as { home?: string });
  const s = createRuntimeServices({ home: globalOpts.home, ensureDefaultHub: true }, projectRoot);
  const bundle = managerSkillBundle();

  const seeded = s.managerSkill.seed(bundle);
  const seedNotes: Record<string, string> = {
    seeded: `installed the manager skill (skills-manager v${bundle.version})`,
    refreshed: `updated the manager skill to v${bundle.version}`,
    'up-to-date': `manager skill already current (v${bundle.version})`,
    'user-managed': 'kept the existing skills-manager copy (installed or edited outside bootstrap)',
  };
  console.log(`• skill home: ${s.resolution.root}${s.resolution.created ? ' (created)' : ''}`);
  console.log(`• ${seedNotes[seeded.status]}`);

  const detected = s.catalog.detected();
  const agents = await chooseAgents(opts, detected, s.catalog.resolveGlobalDir.bind(s.catalog));
  if (agents.length > 0) {
    try {
      const applied = s.distribute.apply({ to: 'user', skills: [MANAGER_SKILL_NAME], agents, mode: 'symlink', force: Boolean(opts.force) });
      const dirs = [...new Set(applied.entries.map((entry) => entry.runtimePath))];
      console.log(`• mounted to: ${dirs.join(', ')}`);
    } catch (error) {
      if (error instanceof SkillsManagerError && error.code === 'distribute_foreign_exists') {
        throw new SkillsManagerError('bootstrap_foreign_runtime', `${error.message} Re-run with --force to replace it, or remove it first.`);
      }
      throw error;
    }
  } else {
    console.log('• manager skill mounted nowhere yet.');
    console.log('  To mount later: npx skills-manager-cli bootstrap --agent <id>');
  }

  // Bootstrap never imports — it only reports what the user can bring in later (ADR-0014).
  try {
    const preview = s.init.run({ dryRun: true });
    if (preview.imported.length > 0) {
      const conflicts = preview.conflicts.length > 0 ? ` (+${preview.conflicts.length} needing decisions)` : '';
      console.log(`• found ${preview.imported.length} existing skill(s) in your agent dirs${conflicts}.`);
      console.log(`  Import them later from your agent: “${IMPORT_PROMPT_ZH}”`);
    }
  } catch {
    /* zero detected agents — there is nothing to preview */
  }

  s.activity.record({ action: 'cli-bootstrap', summary: `Bootstrap: ${seeded.status}, mounted to ${agents.join(', ') || 'none'}`, details: { seeded: seeded.status, agents } });
  console.log('\nAll set. Go back to your agent and say:');
  console.log(`  “${STARTER_PROMPT_ZH}”`);
  console.log(`  (“${STARTER_PROMPT_EN}”)`);
}

/** `--agent` wins; one detected agent needs no question; several get the picker in a TTY, all of them otherwise. */
async function chooseAgents(opts: BootstrapOptions, detected: readonly string[], resolveGlobalDir: (id: string) => string | null): Promise<readonly string[]> {
  if (opts.agent && opts.agent.length > 0) return opts.agent;
  if (detected.length <= 1) return detected;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return detected;
  const options: SelectOption[] = detected.map((id) => ({ id, label: id, detail: resolveGlobalDir(id) ?? undefined }));
  return multiSelect('Install the manager skill into:', options);
}
