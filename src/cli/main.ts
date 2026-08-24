#!/usr/bin/env node
import { Command } from 'commander';
import { createRuntimeServices, projectRootFromImportMeta } from '../infra/runtime.js';
import { startDashboardServer } from '../dashboard/server/main.js';
import { CONSUMERS } from '../core/model/index.js';

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

program.command('dashboard')
  .description('Start the local dashboard')
  .option('-p, --port <port>', 'port', '4777')
  .option('--host <host>', 'host', '127.0.0.1')
  .option('--no-open', 'do not open a browser')
  .action((opts, cmd) => {
    const globalOpts = (cmd.optsWithGlobals() as { home?: string });
    return startDashboardServer({ home: globalOpts.home, port: Number(opts.port), host: opts.host, open: opts.open, projectRoot });
  });

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
  .option('-c, --consumer <consumer>', `filter consumer: ${CONSUMERS.join(', ')}`)
  .option('--category <category>', 'filter category')
  .option('--include-archived', 'include archived entries')
  .action((opts, cmd) => print(services(cmd).registry.listSkills({ consumer: opts.consumer, category: opts.category, includeArchived: opts.includeArchived })));

program.command('add')
  .description('Discover from a source, then install selected skills')
  .argument('<source>', 'Git URL, GitHub owner/repo, GitHub tree URL, or local path')
  .option('--list', 'only list discovered skills')
  .option('--all', 'install all discovered skills')
  .option('-s, --skill <skill...>', 'skill name or source subpath to install')
  .option('-c, --consumer <consumer...>', `consumers: ${CONSUMERS.join(', ')}`)
  .option('-y, --yes', 'overwrite existing skills without prompting')
  .action((source, opts, cmd) => {
    const s = services(cmd);
    const checkout = s.source.checkout(source);
    const discovered = s.source.discover(checkout);
    if (opts.list) return print({ source: checkout, discovered });
    const selectors = opts.all ? discovered.map((skill) => skill.subpath) : (opts.skill || []);
    if (!opts.all && selectors.length === 0) throw new Error('Use --all or --skill <name-or-subpath> to choose skills in this non-interactive CLI.');
    const result = s.install.installFromSourceSelection({ source, selectors, consumers: opts.consumer, overwrite: Boolean(opts.yes) });
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
  .option('-c, --consumer <consumer...>', `consumers: ${CONSUMERS.join(', ')}`)
  .option('--mode <mode>', 'symlink or copy')
  .option('--force', 'overwrite unmanaged runtime paths')
  .enablePositionalOptions()
  .action((opts, cmd) => {
    if (!opts.to) throw new Error('--to is required (user or project)');
    const s = services(cmd);
    const result = s.distribute.apply({ to: opts.to, projectRoot: opts.project, skills: opts.skill || [], consumers: opts.consumer, mode: opts.mode, force: Boolean(opts.force) });
    s.activity.record({ action: 'cli-distribute', summary: `Distributed ${(opts.skill || []).join(', ')} to ${opts.to}`, details: opts });
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
  .option('-c, --consumer <consumer...>', `consumers: ${CONSUMERS.join(', ')}`)
  .action((opts, cmd) => {
    const s = services(cmd);
    const result = s.distribute.undistribute({ to: opts.to, projectRoot: opts.project, skills: opts.skill || [], consumers: opts.consumer });
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

program.command('expose').description('Deprecated alias: distribute selected skills to the user runtime').argument('<consumer>').argument('<skills...>').action((consumer, skills, cmd) => {
  const s = services(cmd);
  const result = s.distribute.apply({ to: 'user', skills, consumers: [consumer] });
  s.activity.record({ action: 'cli-expose', summary: `Distributed ${skills.join(', ')} to user ${consumer}`, details: { consumer, skills } });
  print(result);
});
program.command('hide').description('Deprecated alias: undistribute selected skills from the user runtime').argument('<consumer>').argument('<skills...>').action((consumer, skills, cmd) => {
  const s = services(cmd);
  const result = s.distribute.undistribute({ to: 'user', skills, consumers: [consumer] });
  s.activity.record({ action: 'cli-hide', summary: `Undistributed ${skills.join(', ')} from user ${consumer}`, details: { consumer, skills } });
  print(result);
});
program.command('rebuild-views').description('Deprecated: hub views are no longer generated').action(() => { print({ ok: true, deprecated: true, message: 'rebuild-views is deprecated. Use distribute / redistribute --outdated. Hub views/ is not rebuilt.' }); });
program.command('rebuild-collections').description('Regenerate category collections').action((_opts, cmd) => { services(cmd).views.rebuildCollections(); print('collections rebuilt'); });
program.command('archive').description('Archive canonical skills without permanent deletion').argument('<skills...>').action((skills, cmd) => print(services(cmd).archive.archiveSkills(skills)));
program.command('adopt').description('Adopt a real directory from a generated view into canonical skills').argument('<view>').argument('<skill>').argument('[alsoConsumers...]').action((view, skill, alsoConsumers, cmd) => print(services(cmd).adopt.adopt(view, skill, alsoConsumers || [])));
program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
