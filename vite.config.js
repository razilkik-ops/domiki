import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        malta: resolve(process.cwd(), 'malta.html'),
        valencia: resolve(process.cwd(), 'valencia.html'),
        bath: resolve(process.cwd(), 'bath.html'),
        apartments: resolve(process.cwd(), 'apartments.html'),
      },
    },
  },
});
