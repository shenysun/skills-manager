import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue()],
  build: {
    outDir: '../dist/admin-web',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4777',
    },
  },
});
