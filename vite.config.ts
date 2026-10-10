import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'client/index.html'),
        join: resolve(__dirname, 'client/join.html'),
        dev: resolve(__dirname, 'client/dev.html'),
        screen: resolve(__dirname, 'client/screen.html'),
        styles: resolve(__dirname, 'client/styles.html'),
      },
    },
  },
});
