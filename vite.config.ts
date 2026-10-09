import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
// From 'vitest/config', not 'vite' — defineConfig from 'vite' rejects the `test` key.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Pinned so the DST cases can actually fail. Without it the suite runs in
    // whatever zone the machine is in, and a test named after the 25 October
    // 2026 change proves nothing on a UTC runner.
    env: { TZ: 'Europe/Paris' },
  },
});
