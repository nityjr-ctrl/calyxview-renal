import path from 'node:path';
import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { publicBenchmark } from './lib/public-benchmark';

const benchmarkModule = 'virtual:calyxview-benchmark';

export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react(), {
    name: 'public-benchmark-evidence',
    resolveId(id) { if (id === benchmarkModule) return '\0' + benchmarkModule; },
    load(id) {
      if (id !== '\0' + benchmarkModule) return;
      const file = path.resolve(import.meta.dirname, 'research/kits23-feasibility/results/summary.public.json');
      this.addWatchFile(file);
      const result = publicBenchmark(JSON.parse(readFileSync(file, 'utf8')));
      if (result.state === 'unavailable') throw new Error('Benchmark evidence failed validation: ' + result.reason);
      return 'export default ' + JSON.stringify(result);
    },
  }],
  server: {
    host: '127.0.0.1',
    port: 3000,
  },
  preview: {
    host: '127.0.0.1',
    port: 3000,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  build: {
    outDir: 'netlify-dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
  },
});
