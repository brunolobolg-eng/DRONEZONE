/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Caminhos relativos: o mesmo build funciona em servidor web e carregado pelo Electron via file://.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    restoreMocks: true,
  },
});
