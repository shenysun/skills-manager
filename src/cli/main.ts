#!/usr/bin/env node
import { Command } from 'commander';
import { createRuntimeServices, projectRootFromImportMeta } from '../infra/runtime.js';
import { startDashboardServer } from '../dashboard/server/main.js';

const projectRoot = projectRootFromImportMeta(import.meta.url);

function services(cmd: Command) {
  const opts = (cmd.optsWithGlobals() as { home?: string });
  return createRuntimeServices({ home: opts.home }, projectRoot);
}

function print(value: unknown) {
  if (typeof value === 'string') console.log(value);
  else console.log(JSON.stringify(value, null, 2));
}

const program = new Command();
program
  .name('skills-manager')
  .description('Local-first CLI and dashboard for managing agent skills')
  .version('0.1.0')
  .option('--home <path>', 'skill home path; overrides SKILL_HOME and cwd detection')
  .showHelpAfterError();

const webCommand = (cmd: Command, description: string) =>
  cmd
    .description(description)
    .option('-p, --port <port>', 'port', '4777')
    .option('--host <host>', 'host', '127.0.0.1')
    .option('--no-open', 'do not open a browser')
    .action((opts, self) => {
      const globalOpts = (self.optsWithGlobals() as { home?: string });
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

program.command('init')
  .description('Import skills already living in agent runtime dirs into the hub (reverse of distribute); origins become managed symlinks')
  .option('-a, --agent <id...>', 'catalog agent ids to scan; defaults to the detected set')
  .option('-r, --resolve <skill=choice...>', 'conflict decisions: <skill>=<runtime-dir|agent-id|hub>')
  .option('--all', 'import everything unambiguous; skip clashing skills (hub wins hub-vs-runtime)')
  .option('--dry-run', 'print the full plan without touching disk')
  .action((opts, cmd) => {
    const s = services(cmd);
    const result = s.init.run({ agents: opts.agent, resolve: parseResolve(opts.resolve), dryRun: Boolean(opts.dryRun), all: Boolean(opts.all) });
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
  .option('--source-url <url>', 'upstream repository URL; enables update management for imported skills')
  .option('--source-ref <ref>', 'branch or tag to track')
  .option('--title <title>', 'display title')
  .option('--description <description>', 'short description')
  .option('--category <category>', 'category')
  .option('--tags <tags...>', 'tags')
  .action((skill, opts, cmd) => {
    const s = services(cmd);
    const patch: Record<string, unknown> = {};
    if (opts.title !== undefined) patch.title = opts.title;
    if (opts.description !== undefined) patch.description = opts.description;
    if (opts.category !== undefined) patch.category = opts.category;
    if (opts.tags !== undefined) patch.tags = opts.tags;
    if (opts.sourceUrl !== undefined || opts.sourceRef !== undefined) {
      patch.source = { ...(opts.sourceUrl !== undefined ? { type: 'git', url: opts.sourceUrl } : {}), ...(opts.sourceRef !== undefined ? { ref: opts.sourceRef } : {}) };
    }
    const result = s.registry.editSafeFields(skill, patch);
    s.activity.record({ action: 'cli-edit', summary: `Edited ${skill}`, details: patch });
    print(result);
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
    print({ snapshot: s.catalog.snapshotInfo(), detected: s.catalog.detected() });
  });

program.command('list')
  .description('List installed skills')
  .option('--category <category>', 'filter category')
  .option('--include-archived', 'include archived entries')
  .action((opts, cmd) => print(services(cmd).registry.listSkills({ category: opts.category, includeArchived: opts.includeArchived })));

program.command('add')
  .description('Discover from a source, then install selected skills')
  .argument('<source>', 'Git URL, GitHub owner/repo, GitHub tree URL, or local path')
  .option('--list', 'only list discovered skills')
  .option('--all', 'install all discovered skills')
  .option('-s, --skill <skill...>', 'skill name or source subpath to install')
  .option('-y, --yes', 'overwrite existing skills without prompting')
  .action((source, opts, cmd) => {
    const s = services(cmd);
    const checkout = s.source.checkout(source);
    const discovered = s.source.discover(checkout);
    if (opts.list) return print({ source: checkout, discovered });
    const selectors = opts.all ? discovered.map((skill) => skill.subpath) : (opts.skill || []);
    if (!opts.all && selectors.length === 0) throw new Error('Use --all or --skill <name-or-subpath> to choose skills in this non-interactive CLI.');
    const result = s.install.installFromSourceSelection({ source, selectors, overwrite: Boolean(opts.yes) });
    s.activity.record({ action: 'cli-add', summary: `Installed ${result.installed.join(', ')}`, details: { source, installed: result.installed } });
    print(result);
  });

program.command('update')
  .description('Update skills from registry sources')
  .option('-s, --skill <skill...>', 'skill(s) to update')
  .option('--source <key>', 'source group key from updates plan')
  .option('--plan', 'print update plan')
  .action((opts, cmd) => {
    const s = services(cmd);
    if (opts.plan || (!opts.skill && !opts.source)) return print(s.update.plan());
    const result = opts.source ? s.update.updateSource(opts.source) : s.update.updateSkills(opts.skill);
    s.activity.record({ action: 'cli-update', summary: `Updated ${result.updated.join(', ')}`, details: result });
    print(result);
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
  .option('--outdated', 'only outdated fingerprints')
  .option('--to <kind>', 'user or project')
  .option('--project <path>', 'project root filter')
  .option('--force', 'overwrite unmanaged runtime paths')
  .action((opts, cmd) => {
    if (!opts.outdated) throw new Error('Pass --outdated to refresh managed targets');
    const s = services(cmd);
    const result = s.distribute.redistributeOutdated({ to: opts.to, projectRoot: opts.project, force: Boolean(opts.force) });
    s.activity.record({ action: 'cli-redistribute', summary: 'Redistributed outdated targets', details: opts });
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
