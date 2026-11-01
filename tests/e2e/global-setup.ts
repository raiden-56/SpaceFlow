// Prepares the isolated test database: applies migrations, then reseeds the demo dataset.
// Runs once per Playwright invocation. Sessions are NOT stored here: refresh tokens rotate and
// reuse is detected (all sessions revoked), so each test signs in fresh (see helpers.ts).
import { execSync } from 'node:child_process';
import path from 'node:path';

export default function globalSetup() {
  const api = path.resolve(__dirname, '../../apps/api');
  const run = (cmd: string) => execSync(cmd, { cwd: api, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
  run('npx tsx scripts/setup-test-db.ts');
  run('npx tsx scripts/seed-test-db.ts');
}
