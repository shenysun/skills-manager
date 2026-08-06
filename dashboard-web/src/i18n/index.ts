import { createI18n } from 'vue-i18n';
import enUS from './en-US';
import zhCN from './zh-CN';

export const supportedLocales = ['zh-CN', 'en-US'] as const;
export function createDashboardI18n() {
  const saved = localStorage.getItem('skills-manager-locale');
  const locale = saved || (navigator.language.startsWith('zh') ? 'zh-CN' : 'en-US');
  return createI18n({ legacy: false, locale, fallbackLocale: 'en-US', messages: { 'en-US': enUS, 'zh-CN': zhCN } });
}
