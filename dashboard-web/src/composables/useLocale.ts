import { ref } from 'vue';

export type Locale = 'zh-CN' | 'en-US';

export const supportedLocales = ['zh-CN', 'en-US'] as const;

const LOCALE_KEY = 'skills-manager.prefs.locale';

export function detectLocale(): Locale {
  const saved = localStorage.getItem(LOCALE_KEY);
  if (saved === 'zh-CN' || saved === 'en-US') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function persistLocale(locale: Locale) {
  localStorage.setItem(LOCALE_KEY, locale);
}

type I18nLocaleTarget = { locale: { value: string } };

let i18nGlobal: I18nLocaleTarget | null = null;

/** main.ts binds the created i18n instance so setLocale switches it live. */
export function bindLocaleToI18n(target: I18nLocaleTarget) {
  i18nGlobal = target;
}

export function useLocale() {
  const locale = ref<Locale>(detectLocale());

  function setLocale(next: Locale) {
    locale.value = next;
    persistLocale(next);
    if (i18nGlobal) i18nGlobal.locale.value = next;
  }

  return { locale, setLocale, supportedLocales };
}
