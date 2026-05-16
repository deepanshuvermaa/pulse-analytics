import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: { outDir: '../dist/client' },
  server: { proxy: { '/api': 'http://localhost:3000', '/t.js': 'http://localhost:3000' } },
});
