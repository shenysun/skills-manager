import { ref } from 'vue';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'skills-manager.prefs.theme';

/** Default follows the system; a saved preference wins (spec §Implementation Decisions · Prefs). */
export function detectTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return systemTheme();
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function persistTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const theme = ref<Theme>(detectTheme());
  applyTheme(theme.value);

  // While no preference is saved, keep following the system live.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    if (localStorage.getItem(THEME_KEY)) return;
    theme.value = event.matches ? 'dark' : 'light';
    applyTheme(theme.value);
  });

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
    applyTheme(theme.value);
    persistTheme(theme.value);
  }

  return { theme, toggleTheme };
}
