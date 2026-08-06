import { ref, watchEffect } from 'vue';
export type Theme = 'system' | 'light' | 'dark';
export const theme = ref<Theme>((localStorage.getItem('skills-manager-theme') as Theme) || 'system');
export function useTheme() {
  watchEffect(() => {
    localStorage.setItem('skills-manager-theme', theme.value);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = theme.value === 'system' ? (prefersDark ? 'dark' : 'light') : theme.value;
  });
  return { theme };
}
