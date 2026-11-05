import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
  preview: {
    port: 4173,
    // Demos through a hosted preview link: set PREVIEW_ALLOW_ALL_HOSTS=1.
    allowedHosts: process.env.PREVIEW_ALLOW_ALL_HOSTS ? true : undefined,
    proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
