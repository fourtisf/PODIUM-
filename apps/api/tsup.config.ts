import { defineConfig } from 'tsup';

// One CommonJS file for PM2. The workspace packages are TypeScript source, so they are bundled in;
// everything from node_modules stays external and is resolved at run time.
export default defineConfig({
  entry: { server: 'src/server.ts' },
  outDir: 'dist',
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@podium\//],
});
