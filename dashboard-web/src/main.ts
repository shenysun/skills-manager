import { createApp } from 'vue';
import App from './App.vue';
import { createDashboardI18n } from './i18n';
import { applyTheme, detectTheme } from './composables/useTheme';
import './styles/tokens.css';
import './styles/page.css';
import './styles/sheet.css';

applyTheme(detectTheme());

createApp(App).use(createDashboardI18n()).mount('#app');
