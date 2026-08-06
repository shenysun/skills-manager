import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
export function useLocale() {
  const { locale } = useI18n();
  const current = computed({ get: () => String(locale.value), set: (value: string) => { locale.value = value; localStorage.setItem('skills-manager-locale', value); } });
  return { locale: current };
}
