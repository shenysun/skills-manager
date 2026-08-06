export default {
  app: { title: 'Skills Manager', subtitle: 'Developer Control Center', refresh: 'Refresh', language: 'Language', theme: 'Theme', system: 'System', light: 'Light', dark: 'Dark' },
  nav: { overview: 'Overview', installed: 'Installed', sources: 'Sources', discover: 'Discover', updates: 'Updates', registry: 'Registry', activity: 'Activity', settings: 'Settings' },
  common: { skill: 'Skill', source: 'Source', path: 'Path', category: 'Category', consumers: 'Consumers', actions: 'Actions', update: 'Update', install: 'Install', archive: 'Archive', expose: 'Expose', hide: 'Hide', run: 'Run', edit: 'Edit', save: 'Save', cancel: 'Cancel', search: 'Search', selected: 'selected', status: 'Status', count: 'Count', files: 'Files', details: 'Details', error: 'Error: {message}', ready: 'Ready.', gitDiffNext: 'Operation complete. Review changes with git diff before committing.' },
  overview: { title: 'Overview', health: 'Health at a glance', runDoctor: 'Run Doctor', warnings: 'Registry warnings', broken: 'Broken symlinks', git: 'Git status', recent: 'Recent activity', skills: 'Skills', sources: 'Sources', agents: 'Agents exposed', claude: 'Claude exposed' },
  installed: { title: 'Installed skills', filter: 'Search name, category, consumer, source', drawer: 'Skill details', updateSelected: 'Update selected', archiveSelected: 'Archive selected', noDelete: 'Permanent delete is disabled in v1.' },
  sources: { title: 'Sources', hint: 'Groups are built from registry source.url + source.ref.', discoverMore: 'Discover more', updateSource: 'Update source' },
  discover: { title: 'Discover', stepSource: '1. Source', stepSkills: '2. Skills', stepConsumers: '3. Consumers', stepReview: '4. Review', sourcePlaceholder: 'owner/repo, Git URL, GitHub tree URL, or local path', discovered: 'Discovered {count} skill(s)', overwrite: 'Existing skills will be overwritten only after review.' },
  updates: { title: 'Updates', bySkill: 'By Skill', bySource: 'By Source', fromUrl: 'From URL', plan: 'Update plan' },
  registry: { title: 'Registry', safeEdit: 'Structured safe-field editing only. Raw YAML is not the primary workflow.', editSkill: 'Edit registry entry' },
  activity: { title: 'Activity', operations: 'Operation log', git: 'Git history' },
  settings: { title: 'Settings', home: 'Skill home', package: 'Package', pack: 'npm pack dry-run', docs: 'Use npx or a global install to run skills-manager.' },
};
