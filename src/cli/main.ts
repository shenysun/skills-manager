#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { createRuntimeServices, projectRootFromImportMeta } from '../infra/runtime.js';
import { normalizeGitSourceUrl } from '../core/services/source-service.js';
import { SkillsManagerError } from '../shared/errors.js';
import { redactCheckout, redactDiscovered } from '../shared/redact.js';
import { NodeFileSystem } from '../infra/fs-skill-home.js';
import { GitHubApiClient } from '../infra/github-api-client.js';
import { DetectionService, detectionLogPath } from '../core/services/detection-service.js';
import path from 'node:path';
import { runBootstrap, managerSkillBundle } from './bootstrap.js';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };
const projectRoot = projectRootFromImportMeta(import.meta.url);

function services(cmd: Command, options: { bootstrap?: boolean } = {}) {
  const opts = (cmd.optsWithGlobals() as { home?: string });
  const runtime = createRuntimeServices({ home: opts.home, ensureDefaultHub: Boolean(options.bootstrap) }, projectRoot);
  if (!options.bootstrap && !runtime.resolution.exists) {
    throw new SkillsManagerError(
      'no_skill_home',
      `No skill home at ${runtime.resolution.root} yet. Run \`npx skills-manager-cli\` first — it creates the hub and installs the manager skill. (Or point --home at an existing hub.)`,
    );
  }
  selfCheckManagerSkill(runtime);
  return runtime;
}

/**
 * Every CLI run keeps the hub's manager skill in step with the bundled copy
 * (ADR-0014) — refresh silently when we still own it, never touch a
 * user-modified copy, and never let this break the actual command. Notices go
 * to stderr so stdout stays parseable JSON.
 */
function selfCheckManagerSkill(s: ReturnType<typeof createRuntimeServices>) {
  try {
    const result = s.managerSkill.selfCheck(managerSkillBundle());
    if (result?.status === 'refreshed') console.error(`Refreshed the manager skill to v${pkg.version} to match this CLI version.`);
  } catch {
    /* the manager skill must never break an unrelated command */
  }
}

function print(value: unknown) {
  if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

const program = new Command();
program
  .name('skills-manager')
  .description('Local-first CLI and dashboard for managing agent skills')
  .version(pkg.version)
  .option('--home <path>', 'skill home path; overrides SKILL_HOME and cwd detection')
  .showHelpAfterError();

// Bootstrap is the product's front door (ADR-0014): the no-arg run and the
// named command share one handler. `--agent`/`--force` live on the named
// command only — the no-arg path is the interactive/default experience.
program.command('bootstrap')
  .description('One-time setup: create the hub, install the manager skill, mount it to your agents (the default when no subcommand is given)')
  .option('-a, --agent <id...>', 'catalog agent ids to mount to; skips the interactive picker')
  .option('--force', 'replace an unmanaged skills-manager directory at a runtime path')
  .action(runBootstrap);
program.argument('[stray...]');
program.action((stray: string[] | undefined, opts, cmd) => {
  // A typo'd subcommand must not silently run bootstrap: with a program-level
  // action, commander hands it over as an operand instead of erroring.
  if (stray && stray.length > 0) throw new Error(`unknown command '${stray[0]}'. Run 'skills-manager --help' for the command list.`);
  return runBootstrap(opts, cmd);
});

const webCommand = (cmd: Command, description: string) =>
  cmd
    .description(description)
    .option('-p, --port <port>', 'port', '4777')
    .option('--host <host>', 'host', '127.0.0.1')
    .option('--no-open', 'do not open a browser')
    .action(async (opts, self) => {
      const globalOpts = (self.optsWithGlobals() as { home?: string });
      // Single entry point (ADR-0014): the dashboard never creates the hub — bootstrap does.
      const probe = createRuntimeServices({ home: globalOpts.home }, projectRoot);
      if (!probe.resolution.exists) {
        throw new SkillsManagerError(
          'no_skill_home',
          `No skill home at ${probe.resolution.root} yet. Run \`npx skills-manager-cli\` first — it creates the hub and installs the manager skill.`,
        );
      }
      selfCheckManagerSkill(probe);
      // Lazy: fastify/shiki/markdown load only for the dashboard command, not on every CLI invocation.
      const { startDashboardServer } = await import('../dashboard/server/main.js');
      return startDashboardServer({ home: globalOpts.home, port: Number(opts.port), host: opts.host, open: opts.open, projectRoot });
    });

webCommand(program.command('web'), 'Start the local web dashboard');
webCommand(program.command('dashboard', { hidden: true }), 'Deprecated alias for web');

program.command('doctor')
  .description('Run health checks')
  .option('--migrate-views', 'distribute leftover hub views to user runtimes')
  .option('--delete-views', 'with --migrate-views, remove generated view symlinks')
  .option('--force', 'with --migrate-views, overwrite unmanaged runtime paths')
  .action((opts, cmd) => {
    const s = services(cmd);
    if (opts.migrateViews) {
      const migrated = s.distribute.migrateViews({ deleteViews: Boolean(opts.deleteViews), force: Boolean(opts.force) });
      s.activity.record({ action: 'cli-migrate-views', summary: 'Migrated leftover hub views', details: migrated });
      return print({ migrated, doctor: s.doctor.check() });
    }
    print(s.doctor.check());
  });

program.command('status')
  .description('Summarize managed distribution health (managed/foreign/outdated/stale)')
  .action((_opts, cmd) => {
    const s = services(cmd);
    const health = s.distribute.status();
    console.log(`managed: ${health.managedEntries}, agents: ${health.agentCoverage}, foreign: ${health.foreign}`);
    console.log(`outdated: ${health.outdated}, errored: ${countErrored(s)}`);
    if (health.outdated > 0) {
      console.log(`Stale copy targets: ${health.outdated}. Run \`skills redistribute --refresh\` to sync.`);
    }
    const records = s.distribute.listIndex();
    const errored = records.flatMap((r) => r.entries.filter((e) => e.error));
    if (errored.length > 0) {
      console.log(`Refresh errors:`);
      for (const entry of errored) {
        console.log(`  ${entry.runtimePath}: ${entry.error?.message}`);
      }
    }
  });

function countErrored(s: ReturnType<typeof services>): number {
  let count = 0;
  for (const record of s.distribute.listIndex()) {
    for (const entry of record.entries) if (entry.error) count += 1;
  }
  return count;
}

/** Stale-or-errored target count, same predicate as the dashboard stale badge (`entry.error || entryOutdated`), so the two never disagree. */
function staleOrErroredCount(s: ReturnType<typeof services>): number {
  return Object.values(s.distribute.staleSummary()).reduce((total, count) => total + count, 0);
}

function remindStaleTargets(s: ReturnType<typeof services>) {
  const stale = staleOrErroredCount(s);
  if (stale > 0) {
    console.log(`Stale or errored copy targets: ${stale}. Run \`skills-manager redistribute --refresh\` to sync.`);
  }
}

program.command('init')
  .description('Import skills already living in agent runtime dirs into the hub (reverse of distribute); origins become managed symlinks')
  .option('-a, --agent <id...>', 'catalog agent ids to scan; defaults to the detected set')
  .option('-r, --resolve <skill=choice...>', 'conflict decisions: <skill>=<runtime-dir|agent-id|hub>')
  .option('--prefer <item...>', 'conflict priority this run: ordered runtime-dir, agent-id, or hub')
  .option('--dry-run', 'print the full plan without touching disk')
  .action((opts, cmd) => {
    const s = services(cmd);
    const result = s.init.run({ agents: opts.agent, resolve: parseResolve(opts.resolve), prefer: opts.prefer, dryRun: Boolean(opts.dryRun) });
    if (!opts.dryRun) s.activity.record({ action: 'cli-init', summary: `Imported ${result.imported.join(', ') || 'nothing'} from runtime dirs`, details: { imported: result.imported, conflicts: result.conflicts, failed: result.failed } });
    print(result);
  });

function parseResolve(values: string[] = []): Record<string, string> {
  const resolve: Record<string, string> = {};
  for (const value of values) {
    const eq = value.indexOf('=');
    if (eq <= 0) throw new Error(`--resolve expects <skill>=<runtime-dir|agent-id|hub>, got "${value}"`);
    resolve[value.slice(0, eq)] = value.slice(eq + 1);
  }
  return resolve;
}

program.command('edit')
  .description('Edit safe registry fields for a skill (e.g. supply the upstream source of an imported skill)')
  .argument('<skill>')
  .option('--source-git <owner/repo|url>', 'upstream git source (owner/repo or repo URL); normalized to the canonical repo URL')
  .option('--source-url <url>', 'upstream repository URL; enables update management for imported skills')
  .option('--source-ref <ref>', 'branch or tag to track')
  .option('--subpath <path>', 'skill path inside the source repository (requires --source-git or --source-url); enables updates')
  .option('--title <title>', 'display title')
  .option('--description <description>', 'short description')
  .option('--category <category>', 'category')
  .option('--tags <tags...>', 'tags')
  .action((skill, opts, cmd) => {
    const s = services(cmd);
    if (opts.sourceGit !== undefined && opts.sourceUrl !== undefined) throw new Error('Pass either --source-git or --source-url, not both.');
    if (opts.subpath !== undefined && opts.sourceGit === undefined && opts.sourceUrl === undefined) throw new Error('--subpath requires --source-git or --source-url (a source to attach the path to).');
    const patch: Record<string, unknown> = {};
    if (opts.title !== undefined) patch.title = opts.title;
    if (opts.description !== undefined) patch.description = opts.description;
    if (opts.category !== undefined) patch.category = opts.category;
    if (opts.tags !== undefined) patch.tags = opts.tags;
    if (opts.sourceGit !== undefined) {
      patch.source = { type: 'git', url: normalizeGitSourceUrl(opts.sourceGit), ...(opts.subpath !== undefined ? { subpath: opts.subpath } : {}), ...(opts.sourceRef !== undefined ? { ref: opts.sourceRef } : {}) };
    } else if (opts.sourceUrl !== undefined || opts.sourceRef !== undefined || opts.subpath !== undefined) {
      patch.source = { ...(opts.sourceUrl !== undefined ? { type: 'git', url: opts.sourceUrl } : {}), ...(opts.subpath !== undefined ? { subpath: opts.subpath } : {}), ...(opts.sourceRef !== undefined ? { ref: opts.sourceRef } : {}) };
    }
    const result = s.registry.editSafeFields(skill, patch);
    s.activity.record({ action: 'cli-edit', summary: `Edited ${skill}`, details: patch });
    print(result);
  });

const provenance = program.command('provenance').description('Backfill provenance for source-less skills (lockfile evidence adoption, ADR-0011/0012)');
provenance.command('adopt')
  .description('Adopt npx skills lockfile evidence onto legacy imported skills that have no source yet')
  .option('--dry-run', 'print what would be adopted without touching the registry')
  .option('-s, --skill <skill...>', 'limit adoption to specific skills')
  .action((opts, cmd) => {
    const s = services(cmd);
    const result = s.provenance.adopt({ dryRun: Boolean(opts.dryRun), skills: opts.skill });
    if (!opts.dryRun) s.activity.record({ action: 'cli-provenance-adopt', summary: `Adopted lockfile evidence for ${result.adopted.map((item) => item.skill).join(', ') || 'nothing'}`, details: { adopted: result.adopted.map((item) => item.skill), skipped: result.skipped } });
    print(result);
  });
provenance.command('list')
  .description('List skills still missing a source: imported-without-source vs locally authored')
  .option('--json', 'machine-readable output for agents')
  .action((opts, cmd) => {
    const pending = services(cmd).provenance.pending();
    if (opts.json) return print(pending);
    console.log(`Imported without source (${pending.importedWithoutSource.length}):`);
    for (const item of pending.importedWithoutSource) console.log(`  ${item.skill}${item.importedAt ? ` (imported ${item.importedAt})` : ''}`);
    console.log(`Locally authored, no upstream recorded (${pending.locallyAuthored.length}):`);
    for (const skill of pending.locallyAuthored) console.log(`  ${skill}`);
  });

const backup = program.command('backup').description('Inspect and restore init backups (hub .backups/, 30-day retention)');backup.command('list')
  .description('List saved backups')
  .action((_opts, cmd) => print(services(cmd).backups.list()));
backup.command('restore')
  .description('Roll one skill fully back to its pre-init state')
  .argument('<skill>')
  .action((skill, _opts, cmd) => {
    const s = services(cmd);
    const result = s.backups.restore(skill);
    s.activity.record({ action: 'cli-backup-restore', summary: `Restored ${skill} from backup`, details: result });
    print(result);
  });

const catalog = program.command('catalog').description('Manage the bundled agent catalog snapshot');
catalog.command('refresh')
  .description('Pull the upstream agent table and overwrite the local catalog snapshot')
  .action(async (_opts, cmd) => {
    const s = services(cmd);
    const result = await s.catalog.refresh();
    s.activity.record({ action: 'cli-catalog-refresh', summary: `Refreshed agent catalog to ${result.commit.slice(0, 10)} (${result.agentCount} agents)`, details: result });
    print(result);
  });
catalog.command('info')
  .description('Show the current catalog snapshot stamp and detected agents')
  .action((_opts, cmd) => {
    const s = services(cmd);
    // Detected agents carry their runtime dir: a bare id list gives a
    // conversation nothing to choose by (ticket manager-skill-first/04).
    const detected = s.catalog.detected().map((id) => ({ id, runtimeDir: s.catalog.resolveGlobalDir(id) }));
    print({ snapshot: s.catalog.snapshotInfo(), detected });
  });

program.command('list')
  .description('List installed skills')
  .option('--category <category>', 'filter category')
  .option('--include-archived', 'include archived entries')
  .option('--brief', 'compact rows (name, title, category, updatable) — for conversation-sized output')
  .action((opts, cmd) => {
    const rows = services(cmd).registry.listSkills({ category: opts.category, includeArchived: opts.includeArchived });
    if (!opts.brief) return print(rows);
    // Full rows carry complete descriptions and consumer lists — tens of KB on
    // a real hub. The brief form answers "what do I have" without them.
    return print(rows.map((row) => ({
      name: row.name,
      title: row.title,
      category: row.category,
      updatable: Boolean(row.source?.url && row.source?.subpath),
      archived: Boolean(row.archived),
    })));
  });

program.command('add')
  .description('Discover from a source, then install selected skills')
  .argument('<source>', 'Git URL, GitHub owner/repo, GitHub tree URL, or local path')
  .option('--list', 'only list discovered skills')
  .option('--all', 'install all discovered skills')
  .option('-s, --skill <skill...>', 'skill name or source subpath to install')
  .option('-y, --yes', 'overwrite existing skills without prompting')
  .action((source, opts, cmd) => {
    const s = services(cmd);
    if (opts.list) {
      return s.source.withCheckout(source, undefined, (checkout) => {
        const discovered = s.source.discover(checkout);
        return print({ source: redactCheckout(checkout), discovered: discovered.map(redactDiscovered) });
      });
    }
    if (!opts.all && (opts.skill || []).length === 0) throw new Error('Use --all or --skill <name-or-subpath> to choose skills in this non-interactive CLI.');
    // Empty selectors mean "everything discovered" — the --all semantics.
    const selectors = opts.all ? [] : (opts.skill || []);
    const result = s.install.installFromSourceSelection({ source, selectors, overwrite: Boolean(opts.yes) });
    s.activity.record({ action: 'cli-add', summary: `Installed ${result.installed.join(', ')}`, details: { source, installed: result.installed } });
    print({ ...result, plan: { ...result.plan, source: redactCheckout(result.plan.source), selected: result.plan.selected.map(redactDiscovered) } });
    remindStaleTargets(s);
  });

program.command('update')
  .description('Update skills from registry sources')
  .option('-s, --skill <skill...>', 'skill(s) to update')
  .option('--source <key>', 'source group key from updates plan')
  .option('--plan', 'print update plan (candidates only)')
  .option('--check', 'run upstream freshness detection: stale / upToDate / failed / skipped per skill (uncalibrated entries adopt their observed anchor, ADR-0013)')
  .action(async (opts, cmd) => {
    const s = services(cmd);
    if (opts.check) {
      const detection = new DetectionService({ githubApi: new GitHubApiClient(), fs: new NodeFileSystem() });
      const listed = s.registry.listSkills({ includeArchived: false });
      const outcomes = await detection.detect(s, listed);
      const detectionLog = detectionLogPath(s.resolution.root);
      const stale: Array<{ skill: string; url: string }> = [];
      const failed: Array<{ skill: string; log: string }> = [];
      const upToDate: string[] = [];
      const skipped: string[] = [];
      for (const skill of listed) {
        const outcome = outcomes.get(skill.name);
        // No outcome = not part of this round (source-less rows and friends):
        // counted as skipped, same wording the dashboard uses — never dropped
        // silently (adversary M4).
        if (!outcome || outcome.detection === 'skipped') { skipped.push(skill.name); continue; }
        if (outcome.detection === 'failed') failed.push({ skill: skill.name, log: detectionLog });
        else if (outcome.hasUpdate) stale.push({ skill: skill.name, url: skill.source.url ?? '' });
        else upToDate.push(skill.name);
      }
      print({ checked: stale.length + failed.length + upToDate.length + skipped.length, stale, upToDate, failed, skipped });
      // A failed check is a failed check — scripts read the exit code (adversary M6).
      if (failed.length > 0) process.exitCode = 1;
      return;
    }
    if (opts.plan || (!opts.skill && !opts.source)) return print(s.update.plan());
    const result = opts.source ? s.update.updateSource(opts.source) : s.update.updateSkills(opts.skill);
    s.activity.record({ action: 'cli-update', summary: `Updated ${result.updated.join(', ')}`, details: result });
    print(result);
    remindStaleTargets(s);
  });

const distribute = program.command('distribute')
  .description('Distribute hub skills to user or project runtime directories')
  .option('--to <kind>', 'user or project')
  .option('--project <path>', 'project root (required when --to project)')
  .option('-s, --skill <skill...>', 'canonical skill names')
  .option('-a, --agent <id...>', 'catalog agent ids (repeatable); defaults to the detected set')
  .option('--mode <mode>', 'symlink or copy')
  .option('--force', 'overwrite unmanaged runtime paths')
  .enablePositionalOptions()
  .action((opts, cmd) => {
    if (!opts.to) throw new Error('--to is required (user or project)');
    const s = services(cmd);
    const result = s.distribute.apply({ to: opts.to, projectRoot: opts.project, skills: opts.skill || [], agents: opts.agent, mode: opts.mode, force: Boolean(opts.force) });
    s.activity.record({ action: 'cli-distribute', summary: `Distributed ${(opts.skill || []).join(', ')} to ${opts.to} for ${result.agents.join(', ')}`, details: opts });
    print(result);
  });

function runDistributeRollback(opts: { to: string; project?: string }, cmd: Command) {
  const s = services(cmd);
  if (opts.to !== 'user' && opts.to !== 'project') throw new Error('--to must be user or project');
  const result = s.distribute.rollback(opts.to, opts.project);
  s.activity.record({ action: 'cli-distribute-rollback', summary: `Rolled back ${opts.to} distribution`, details: opts });
  print(result);
}

distribute.command('rollback')
  .description('Restore the last distribute snapshot for a target')
  .requiredOption('--to <kind>', 'user or project')
  .option('--project <path>', 'project root (required when --to project)')
  .action((opts, cmd) => runDistributeRollback(opts, cmd));

program.command('undistribute')
  .description('Remove managed runtime entries without deleting hub skills')
  .requiredOption('--to <kind>', 'user or project')
  .option('--project <path>', 'project root (required when --to project)')
  .option('-s, --skill <skill...>', 'canonical skill names')
  .option('-a, --agent <id...>', 'catalog agent ids (repeatable); defaults to the detected set')
  .action((opts, cmd) => {
    const s = services(cmd);
    const result = s.distribute.undistribute({ to: opts.to, projectRoot: opts.project, skills: opts.skill || [], agents: opts.agent });
    s.activity.record({ action: 'cli-undistribute', summary: `Undistributed ${(opts.skill || []).join(', ')} from ${opts.to}`, details: opts });
    print(result);
  });

program.command('redistribute')
  .description('Re-apply managed distributions')
  .option('--outdated', 'only outdated fingerprints (alias: --refresh)')
  .option('--refresh', 'alias of --outdated: refresh every stale copy target')
  .option('--to <kind>', 'user or project')
  .option('--project <path>', 'project root filter')
  .option('--force', 'overwrite unmanaged runtime paths')
  .action((opts, cmd) => {
    if (!opts.outdated && !opts.refresh) throw new Error('Pass --outdated or --refresh to refresh managed targets');
    const s = services(cmd);
    const result = s.distribute.redistributeOutdated({ to: opts.to, projectRoot: opts.project, force: Boolean(opts.force) });
    s.activity.record({ action: 'cli-redistribute', summary: 'Redistributed outdated targets', details: opts });
    if (opts.refresh) console.log(`Refreshed ${result.refreshed.length}, errored ${result.errored.length}.`);
    print(result);
  });

program.command('distribute-rollback', { hidden: true })
  .description('Deprecated alias for distribute rollback')
  .requiredOption('--to <kind>', 'user or project')
  .option('--project <path>', 'project root (required when --to project)')
  .action((opts, cmd) => runDistributeRollback(opts, cmd));

program.command('migrate-views')
  .description('Distribute leftover hub views to user runtimes')
  .option('--delete-views', 'remove generated view symlinks after migrate')
  .option('--force', 'overwrite unmanaged runtime paths')
  .action((opts, cmd) => {
    const s = services(cmd);
    const result = s.distribute.migrateViews({ deleteViews: Boolean(opts.deleteViews), force: Boolean(opts.force) });
    s.activity.record({ action: 'cli-migrate-views', summary: 'Migrated leftover hub views', details: result });
    print(result);
  });

program.command('migrate-consumers')
  .description('One-shot migration of legacy agents/claude tags to catalog agent ids (registry, hub index)')
  .option('--dry-run', 'print the migration plan without touching disk')
  .option('--rollback', 'restore the files backed up by the last migration')
  .action((opts, cmd) => {
    const s = services(cmd);
    if (opts.rollback) {
      s.migration.rollback();
      s.activity.record({ action: 'cli-migrate-consumers-rollback', summary: 'Rolled back migrate-consumers' });
      return print({ rolledBack: true });
    }
    if (opts.dryRun) return print(s.migration.plan());
    const result = s.migration.apply();
    s.activity.record({ action: 'cli-migrate-consumers', summary: `Migrated legacy consumer tags (${result.migrated.indexEntries} index entries)`, details: result });
    print(result);
  });

program.command('rebuild-collections').description('Regenerate category collections').action((_opts, cmd) => { services(cmd).views.rebuildCollections(); print('collections rebuilt'); });
program.command('archive').description('Archive canonical skills without permanent deletion').argument('<skills...>').action((skills, cmd) => print(services(cmd).archive.archiveSkills(skills)));
program.command('adopt').description('Adopt a real directory from a generated view into canonical skills').argument('<view>').argument('<skill>').argument('[alsoConsumers...]').action((view, skill, alsoConsumers, cmd) => print(services(cmd).adopt.adopt(view, skill, alsoConsumers || [])));
program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
