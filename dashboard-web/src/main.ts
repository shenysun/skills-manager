import { createApp } from 'vue';
import App from './App.vue';
import { createDashboardI18n } from './i18n';
import { bindLocaleToI18n } from './composables/useLocale';
import 'virtual:uno.css';
import './styles/tokens.css';
import './styles/preview.css';


const i18n = createDashboardI18n();
bindLocaleToI18n(i18n.global);

createApp(App).use(i18n).mount('#app');
