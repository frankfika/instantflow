import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787'
    }
  }
});
