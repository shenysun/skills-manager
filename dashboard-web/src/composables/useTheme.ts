import { ref } from 'vue';
import { detectTheme, nextTheme, persistTheme, themeOnSystemChange, type Theme } from '../domain/themePref';

export type { Theme };

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function useTheme() {
  const theme = ref<Theme>(detectTheme(localStorage, systemTheme()));
  applyTheme(theme.value);

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    const next = themeOnSystemChange(localStorage, event.matches ? 'dark' : 'light');
    if (next === null) return;
    theme.value = next;
    applyTheme(next);
  });

  function toggleTheme() {
    const next = nextTheme(theme.value);
    theme.value = next;
    applyTheme(next);
    persistTheme(localStorage, next);
  }

  return { theme, toggleTheme };
}
