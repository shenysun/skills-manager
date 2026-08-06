#!/usr/bin/env node
import { Command } from 'commander';
import { addFromSource, adopt, expose, hide, installGitDeprecated, listCommand, menu, updateGit } from './commands.js';
import { doctor, rebuildCollections, rebuildViews } from './views.js';

const program = new Command();
program
  .name('skills')
  .description('统一管理 agents/Claude skills 的中央仓库')
  .version('0.1.0', '-V, --version', '显示版本号')
  .helpOption('-h, --help', '显示帮助')
  .addHelpCommand('help [command]', '显示命令帮助');

program.command('menu').description('打开交互式菜单').action(menu);
program.command('doctor').description('运行健康检查').action(doctor);
program.command('list').description('列出 skills').option('-c, --consumer <consumer>', '只显示指定消费者：agents 或 claude').option('--category <category>', '只显示指定分类').action(listCommand);
program.command('rebuild-views').description('根据 registry.yaml 重建 views').action(() => { rebuildViews(); console.log('views 已重建'); });
program.command('rebuild-collections').description('根据 registry.yaml 重建 collections').action(() => { rebuildCollections(); console.log('collections 已重建'); });
program.command('expose').description('把 skill 暴露给指定消费者').argument('<skill>', 'skill 名称').argument('<consumers...>', '消费者列表：agents claude').action(expose);
program.command('hide').description('从指定消费者隐藏 skill').argument('<skill>', 'skill 名称').argument('<consumers...>', '消费者列表：agents claude').action(hide);
program.command('add').description('先提供 URL/GitHub 仓库/本地路径，再发现并选择要安装的 skills').argument('<source>', 'Git URL、GitHub owner/repo、GitHub tree URL 或本地路径').option('--list', '只列出可安装 skills，不安装').option('--all', '安装发现到的全部 skills').option('-s, --skill <skill...>', '只安装指定 skill 名称或路径').option('-c, --consumer <consumer...>', '消费者列表：agents claude').option('-y, --yes', '覆盖已有 skill 时跳过确认').action(addFromSource);
program.command('install-git', { hidden: true }).description('已废弃：请使用 skills add <source>').argument('<skill>').argument('<repo>').argument('<subpath>').argument('[consumers...]').action((skill, repo, subpath, consumers) => installGitDeprecated(skill, repo, subpath, consumers?.length ? consumers : ['agents', 'claude']));
program.command('update-git').description('从 Git 仓库更新 skill；默认读取 registry.yaml 中的来源').argument('<skill>', 'skill 名称').argument('[repo]', '可选：覆盖 registry 中的 Git 仓库 URL').argument('[subpath]', '可选：覆盖 registry 中的仓库内子路径').action(updateGit);
program.command('adopt').description('收编被 installer 安装到 view 中的真实目录').argument('<view>', '来源 view：agents 或 claude').argument('<skill>', 'skill 名称').argument('[alsoConsumers...]', '同时暴露给其他消费者').action(adopt);

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
