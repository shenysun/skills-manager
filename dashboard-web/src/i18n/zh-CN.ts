export default {
  library: {
    title: '技能库',
    count: '{n} 个技能',
  },
  search: {
    placeholder: '搜索技能 / 分类 / 描述…',
  },
  status: {
    updatable: '可更新',
    warning: '⚠ 警告',
    agents: '{n} agents',
    unlinked: '未接入',
  },
  row: {
    noDescription: '无描述',
  },
  action: {
    distribute: '接入',
    update: '更新',
    more: '更多',
  },
  empty: {
    filtered: {
      title: '没有匹配「{query}」的技能',
      hint: '这是搜索过滤的结果——调整或清空搜索词即可看到全部技能。',
    },
    library: {
      title: '技能库是空的',
      hint: '用顶部的「＋添加」安装第一个技能。',
    },
  },
  error: {
    loadFailed: '加载失败:{message}',
    retry: '重试',
  },
  picker: {
    title: '接入 {n} 个技能',
    scopeUser: '用户',
    scopeProject: '项目',
    projectRoot: '项目根目录(如 ~/code/myproject)',
    searchPlaceholder: '搜索 agent…',
    detected: '已检测',
    allAgents: '全部目录',
    selectAll: '全选',
    invalid: '此范围不可用',
    noMatch: '没有匹配的 agent。',
    mode: '模式',
    symlink: 'symlink(链接)',
    copy: 'copy(复制)',
    selected: '已选 {n} 个 agent',
    apply: '接入',
    applying: '接入中…',
    cancel: '取消',
  },
  undistribute: {
    title: '撤除接入:{skill}',
    hint: '只移除 agent 侧的接入,技能保留在库中。',
    none: '该技能没有已接入的 agent。',
    apply: '撤除接入',
    cancel: '取消',
  },
  menu: {
    undistribute: '撤除接入…',
    remove: '从库中移除…',
  },
  notice: {
    distributed: '已接入 {skills} → {n} 个 agent',
    undistributed: '已从 {n} 个 agent 撤除接入:{skill}',
  },
};
