// Ensures the isolated test database exists and is migrated before integration tests run.
import 'dotenv/config';
import { execSync } from 'node:child_process';

export default function setup() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must be set to run integration tests');
  }
  execSync('npx tsx scripts/setup-test-db.ts', { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
}
