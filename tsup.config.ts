import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['better-sqlite3'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
