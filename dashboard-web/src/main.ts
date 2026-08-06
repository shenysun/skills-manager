import { createApp } from 'vue';
import App from './app/App.vue';
import { createDashboardI18n } from './i18n';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';

createApp(App).use(createDashboardI18n()).mount('#app');
