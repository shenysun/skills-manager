import { createApp } from 'vue';
import { createI18n } from 'vue-i18n';
import App from './App.vue';
import './style.css';

const messages = {
  zh: {
    title: 'Skills 后台', refresh: '刷新', doctor: '健康检查', installed: '已安装 Skills', search: '搜索 skill / 分类 / 来源', allConsumers: '全部消费者', skill: 'Skill', category: '分类', consumers: '消费者', source: '来源', updateSelected: '更新选中', expose: '暴露', hide: '隐藏', updateBySource: '按来源更新', updateBySourceHint: '从 registry.yaml 自动聚合 source.url + source.ref，选择一个来源后更新该来源下已安装的 skills。', count: '数量', action: '操作', update: '更新', logs: '日志', ready: '准备就绪。', discoverInstall: '从 URL/Git 发现并安装', registrySources: '注册表来源', sourcePlaceholder: 'owner/repo、Git URL、GitHub tree URL 或本地路径', discover: '发现', installSelected: '安装/覆盖选中', path: '路径', description: 'Description', registryHint: '这里展示 registry 中可更新的条目。你也可以直接在上方 Skills 表格多选更新。', confirmUpdate: '确认更新 {count} 个 skill？', confirmSource: '确认更新该来源下的 skills？', confirmInstall: '确认安装/覆盖 {count} 个 skill？', chooseSkill: '请先选择 skill。', chooseSourceSkill: '请先发现并选择 skill。', inputSource: '请输入来源。', refreshed: '已刷新。', discovered: '发现 {count} 个 skill。', error: '错误：{message}', language: '语言', gitStatus: 'Git 状态' },
  en: {
    title: 'Skills Admin', refresh: 'Refresh', doctor: 'Doctor', installed: 'Installed Skills', search: 'Search skill / category / source', allConsumers: 'All consumers', skill: 'Skill', category: 'Category', consumers: 'Consumers', source: 'Source', updateSelected: 'Update selected', expose: 'Expose', hide: 'Hide', updateBySource: 'Update by source', updateBySourceHint: 'Group installed skills by source.url + source.ref from registry.yaml and update a selected source.', count: 'Count', action: 'Action', update: 'Update', logs: 'Logs', ready: 'Ready.', discoverInstall: 'Discover and install from URL/Git', registrySources: 'Registry sources', sourcePlaceholder: 'owner/repo, Git URL, GitHub tree URL, or local path', discover: 'Discover', installSelected: 'Install/overwrite selected', path: 'Path', description: 'Description', registryHint: 'Updatable entries from registry. You can also update selected skills from the table above.', confirmUpdate: 'Update {count} skill(s)?', confirmSource: 'Update skills from this source?', confirmInstall: 'Install/overwrite {count} skill(s)?', chooseSkill: 'Select skills first.', chooseSourceSkill: 'Discover and select skills first.', inputSource: 'Enter a source first.', refreshed: 'Refreshed.', discovered: 'Discovered {count} skill(s).', error: 'Error: {message}', language: 'Language', gitStatus: 'Git status' },
};

const locale = localStorage.getItem('skills-admin-locale') || (navigator.language.startsWith('zh') ? 'zh' : 'en');
const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en', messages });

createApp(App).use(i18n).mount('#app');
