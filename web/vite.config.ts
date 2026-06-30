import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.VITE_API_BASE ?? 'http://localhost:4000' } },
  test: { environment: 'jsdom', globals: true },
});
