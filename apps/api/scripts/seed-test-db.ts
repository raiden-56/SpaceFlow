// Seeds the ISOLATED test database (TEST_DATABASE_URL) with the demo dataset.
// Used by the Playwright global setup so E2E runs never touch the development database.
import 'dotenv/config';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error('TEST_DATABASE_URL is not set');
  process.exit(1);
}
process.env.DATABASE_URL = testUrl;
// prisma/seed.ts truncates every table and provisions the demo organisation on import.
await import('../prisma/seed.js');
