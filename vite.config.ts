import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

/** Which version this is: the commit (from GitHub Actions, else local git) and when it was built. */
function buildInfo() {
  let commit = process.env.GITHUB_SHA ?? '';
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = 'dev';
    }
  }
  return { commit: commit.slice(0, 7), builtAt: new Date().toISOString() };
}

const BUILD = buildInfo();

/** Writes dist/version.json, which an open TV polls to notice that a newer version went live. */
function versionFile(): Plugin {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(BUILD) });
    },
  };
}

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [versionFile()],
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
