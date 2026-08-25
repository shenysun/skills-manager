export type Theme = 'light' | 'dark';

const THEME_KEY = 'skills-manager.prefs.theme';

/** Default follows the system; a saved preference wins (spec §Implementation Decisions · Prefs). */
export function detectTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function persistTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
}
