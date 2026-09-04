import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import UnoCSS from 'unocss/vite';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue(), UnoCSS({ configFile: fileURLToPath(new URL('./uno.config.ts', import.meta.url)) })],
  build: { outDir: '../dist/dashboard-web', emptyOutDir: true },
  server: { port: 5174, proxy: { '/api': 'http://localhost:4777' } },
});

