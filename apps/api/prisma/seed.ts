// Development seed: wipes the database and provisions the demo organisation
// (2 buildings, 6 floors, 200+ desks, 17 rooms, employees, policies, past/upcoming/cancelled bookings).
// Never run in production: it truncates every table first.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/crypto.js';
import { createDemoOrganization } from '../src/lib/demoData.js';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PROD !== 'true') {
  console.error('Refusing to seed a production database (set SEED_ALLOW_PROD=true to override).');
  process.exit(1);
}

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@spaceflow.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!';
const USER_PASSWORD = process.env.SEED_USER_PASSWORD ?? 'Password123!';

async function truncateAll() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

async function main() {
  console.log('Seeding SpaceFlow demo data…');
  await truncateAll();
  const result = await createDemoOrganization(prisma, {
    slug: 'northwind',
    name: 'Northwind Digital',
    emailDomain: 'spaceflow.local',
    adminEmail: ADMIN_EMAIL,
    adminPasswordHash: await hashPassword(ADMIN_PASSWORD),
    userPasswordHash: await hashPassword(USER_PASSWORD),
  });
  const s = result.stats;
  console.log(`Seeded: ${s.buildings} buildings, ${s.floors} floors, ${s.desks} desks, ${s.rooms} rooms, ${s.users} users, ${s.reservations} reservations.`);
  console.log(`Sign in: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (org admin), employee@spaceflow.local / ${USER_PASSWORD}, facilities@spaceflow.local / ${USER_PASSWORD} (workplace admin), approver@spaceflow.local / ${USER_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
