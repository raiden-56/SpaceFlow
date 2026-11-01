// Production build for the API.
// The shared workspace package (@spaceflow/shared) ships TypeScript source, which Node cannot
// execute, so the API is bundled with esbuild: workspace code is inlined, npm dependencies stay
// external (resolved from node_modules at runtime). Type checking is done separately (tsc --noEmit).
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const external = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => !d.startsWith('@spaceflow/'));

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external: [...external, '@prisma/client', '.prisma/*'],
  // Some CommonJS dependencies are imported from ESM; give them `require` when they need it.
  banner: { js: "import { createRequire as __sfCreateRequire } from 'node:module'; const require = __sfCreateRequire(import.meta.url);" },
  logLevel: 'info',
});
