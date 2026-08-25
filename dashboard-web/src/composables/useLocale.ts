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
