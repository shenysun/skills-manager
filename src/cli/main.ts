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

program.command('doctor').description('Run health checks').action((_opts, cmd) => print(services(cmd).doctor.check()));

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

program.command('expose').description('Expose skills to a consumer').argument('<consumer>').argument('<skills...>').action((consumer, skills, cmd) => { const s = services(cmd); for (const skill of skills) s.views.expose(skill, [consumer]); print({ ok: true, consumer, skills }); });
program.command('hide').description('Hide skills from a consumer').argument('<consumer>').argument('<skills...>').action((consumer, skills, cmd) => { const s = services(cmd); for (const skill of skills) s.views.hide(skill, [consumer]); print({ ok: true, consumer, skills }); });
program.command('rebuild-views').description('Regenerate consumer views').action((_opts, cmd) => { services(cmd).views.rebuildViews(); print('views rebuilt'); });
program.command('rebuild-collections').description('Regenerate category collections').action((_opts, cmd) => { services(cmd).views.rebuildCollections(); print('collections rebuilt'); });
program.command('archive').description('Archive canonical skills without permanent deletion').argument('<skills...>').action((skills, cmd) => print(services(cmd).archive.archiveSkills(skills)));
program.command('adopt').description('Adopt a real directory from a generated view into canonical skills').argument('<view>').argument('<skill>').argument('[alsoConsumers...]').action((view, skill, alsoConsumers, cmd) => print(services(cmd).adopt.adopt(view, skill, alsoConsumers || [])));
program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
