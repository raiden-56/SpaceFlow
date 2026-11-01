// Creates the isolated test database (if missing) and applies migrations to it.
// Uses PrismaClient with a datasource override so no extra driver dependency is needed.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error('TEST_DATABASE_URL is not set');
  process.exit(1);
}
const url = new URL(testUrl);
const dbName = url.pathname.replace(/^\//, '');
const adminUrl = new URL(testUrl);
adminUrl.pathname = '/postgres';

async function main() {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  const exists = await admin.$queryRawUnsafe<{ exists: boolean }[]>(`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = '${dbName.replace(/'/g, "''")}') AS exists`);
  if (!exists[0]?.exists) {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    console.log(`Created database ${dbName}`);
  }
  await admin.$disconnect();
  const db = new PrismaClient({ datasources: { db: { url: testUrl } } });
  await db.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS btree_gist');
  await db.$disconnect();
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: testUrl } });
  console.log('Test database ready');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
