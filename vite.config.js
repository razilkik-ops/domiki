import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/domiki/' : '/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        malta: resolve(process.cwd(), 'malta.html'),
        valencia: resolve(process.cwd(), 'valencia.html'),
        bath: resolve(process.cwd(), 'bath.html'),
        apartments: resolve(process.cwd(), 'apartments.html'),
        privacy: resolve(process.cwd(), 'privacy.html'),
        cookies: resolve(process.cwd(), 'cookies.html'),
      },
    },
  },
});
