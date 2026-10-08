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
  },
});
