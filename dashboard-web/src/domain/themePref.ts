export type Theme = 'light' | 'dark';

export const THEME_KEY = 'skills-manager.prefs.theme';

export type ThemeStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function readSaved(store: ThemeStore): Theme | null {
  const saved = store.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return null;
}

/** Saved pref wins; otherwise the OS preference. */
export function detectTheme(store: ThemeStore, system: Theme): Theme {
  return readSaved(store) ?? system;
}

export function persistTheme(store: ThemeStore, theme: Theme): void {
  store.setItem(THEME_KEY, theme);
}

export function nextTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}

/** `null` means ignore the OS change because a manual Theme is stored. */
export function themeOnSystemChange(store: ThemeStore, system: Theme): Theme | null {
  if (readSaved(store)) return null;
  return system;
}
