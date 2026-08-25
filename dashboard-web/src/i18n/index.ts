import { createI18n } from 'vue-i18n';
import enUS from './en-US';
import zhCN from './zh-CN';
import { detectLocale } from '../composables/useLocale';

export function createDashboardI18n() {
  return createI18n({
    legacy: false,
    locale: detectLocale(),
    fallbackLocale: 'en-US',
    messages: { 'en-US': enUS, 'zh-CN': zhCN },
  });
}
