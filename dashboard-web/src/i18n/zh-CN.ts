export default {
  app: { title: 'Skills Manager', subtitle: '开发者控制中心', refresh: '刷新', language: '语言', theme: '主题', system: '跟随系统', light: '浅色', dark: '深色' },
  nav: { overview: '概览', installed: '已安装', sources: '来源', discover: '发现', updates: '更新', registry: '注册表', activity: '活动', settings: '设置' },
  common: { skill: 'Skill', source: '来源', path: '路径', category: '分类', consumers: '消费者', actions: '操作', update: '更新', install: '安装', archive: '归档', expose: '暴露', hide: '隐藏', run: '运行', edit: '编辑', save: '保存', cancel: '取消', search: '搜索', selected: '已选', status: '状态', count: '数量', files: '文件', details: '详情', error: '错误：{message}', ready: '准备就绪。', gitDiffNext: '操作完成。提交前请运行 git diff 检查变更。' },
  overview: { title: '概览', health: '健康状态速览', runDoctor: '运行 Doctor', warnings: '注册表警告', broken: '损坏软链接', git: 'Git 状态', recent: '最近活动', skills: 'Skills', sources: '来源', agents: 'Agents 暴露', claude: 'Claude 暴露' },
  installed: { title: '已安装 Skills', filter: '搜索名称、分类、消费者、来源', drawer: 'Skill 详情', updateSelected: '更新选中', archiveSelected: '归档选中', noDelete: 'v1 不提供永久删除。' },
  sources: { title: '来源', hint: '按照 registry 中的 source.url + source.ref 聚合。', discoverMore: '从此来源发现更多', updateSource: '更新来源' },
  discover: { title: '发现', stepSource: '1. 来源', stepSkills: '2. Skills', stepConsumers: '3. 消费者', stepReview: '4. 预览', sourcePlaceholder: 'owner/repo、Git URL、GitHub tree URL 或本地路径', discovered: '发现 {count} 个 skill', overwrite: '已有 skill 仅会在确认后覆盖。' },
  updates: { title: '更新中心', bySkill: '按 Skill', bySource: '按来源', fromUrl: '从 URL', plan: '更新计划' },
  registry: { title: '注册表', safeEdit: '仅支持结构化安全字段编辑；原始 YAML 不是主流程。', editSkill: '编辑注册表条目' },
  activity: { title: '活动', operations: '操作记录', git: 'Git 历史' },
  settings: { title: '设置', home: 'Skill home', package: '包信息', pack: 'npm pack dry-run', docs: '可通过 npx 或全局安装运行 skills-manager。' },
};
