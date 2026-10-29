import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the Vite server proxies /api to the FastAPI backend, so the browser
// only ever talks to one origin and no CORS configuration is needed.
const backend = process.env.VITE_BACKEND_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: { '/api': { target: backend, changeOrigin: true } },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
