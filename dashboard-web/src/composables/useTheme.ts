import { computed, ref, watchEffect } from 'vue';

export type Theme = 'system' | 'light' | 'dark';

const prefersDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
mediaQuery.addEventListener('change', (event) => { prefersDark.value = event.matches; });

export const theme = ref<Theme>((localStorage.getItem('skills-manager-theme') as Theme) || 'system');
export const effectiveTheme = computed<'light' | 'dark'>(() => (theme.value === 'system' ? (prefersDark.value ? 'dark' : 'light') : theme.value));

export function useTheme() {
  watchEffect(() => {
    localStorage.setItem('skills-manager-theme', theme.value);
    document.documentElement.dataset.theme = effectiveTheme.value;
  });
  return { theme, effectiveTheme };
}
