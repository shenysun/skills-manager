export default {
  library: {
    title: 'Skill library',
    count: '{n} skills',
  },
  search: {
    placeholder: 'Search skills / categories / descriptions…',
  },
  status: {
    updatable: 'Update available',
    warning: '⚠ warning',
    agents: '{n} agents',
    unlinked: 'not distributed',
  },
  row: {
    noDescription: 'No description',
  },
  action: {
    distribute: 'Distribute',
    update: 'Update',
    more: 'More',
  },
  empty: {
    filtered: {
      title: 'No skills match “{query}”',
      hint: 'This is the search filter at work — adjust or clear the query to see every skill.',
    },
    library: {
      title: 'The library is empty',
      hint: 'Use “＋ Add” at the top to install your first skill.',
    },
  },
  error: {
    loadFailed: 'Failed to load: {message}',
    retry: 'Retry',
  },
  picker: {
    title: 'Distribute {n} skill(s)',
    scopeUser: 'User',
    scopeProject: 'Project',
    projectRoot: 'Project root (e.g. ~/code/myproject)',
    searchPlaceholder: 'Search agents…',
    detected: 'Detected',
    allAgents: 'Full catalog',
    selectAll: 'select all',
    invalid: 'Unavailable in this scope',
    noMatch: 'No matching agents.',
    mode: 'Mode',
    symlink: 'symlink (link)',
    copy: 'copy (copy)',
    selected: '{n} agents selected',
    apply: 'Distribute',
    applying: 'Distributing…',
    cancel: 'Cancel',
  },
  undistribute: {
    title: 'Undistribute: {skill}',
    hint: 'Removes only the agent-side entries; the skill stays in the library.',
    none: 'This skill has no distributed agents.',
    apply: 'Undistribute',
    cancel: 'Cancel',
  },
  menu: {
    undistribute: 'Undistribute…',
    remove: 'Remove from library…',
  },
  notice: {
    distributed: 'Distributed {skills} → {n} agent(s)',
    undistributed: 'Undistributed {skill} from {n} agent(s)',
  },
};
