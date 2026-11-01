import type { BookingPolicy, ResourceType } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';

export type EffectivePolicy = BookingPolicy;

const DEFAULT_POLICY: Omit<BookingPolicy, 'id' | 'orgId' | 'createdAt' | 'updatedAt'> = {
  buildingId: null,
  resourceType: null,
  name: 'System default',
  advanceBookingDays: 30,
  minDurationMinutes: 30,
  maxDurationMinutes: 600,
  slotMinutes: 30,
  maxActiveReservations: 10,
  maxDailyBookings: 3,
  maxWeeklyBookings: 15,
  operatingStart: '07:00',
  operatingEnd: '20:00',
  allowWeekends: false,
  cancellationDeadlineMinutes: 0,
  checkInRequired: true,
  checkInGraceMinutes: 30,
  checkInOpensMinutesBefore: 15,
  autoReleaseEnabled: true,
  allowRecurring: true,
  maxRecurringOccurrences: 12,
  allowMultiDay: true,
  isActive: true,
};

/**
 * Resolve the most specific active policy for a resource:
 *   building + type  >  building only  >  type only  >  org default  >  system default.
 */
export async function resolvePolicy(
  orgId: string,
  buildingId: string,
  resourceType: ResourceType,
  tx: Tx | typeof prisma = prisma,
): Promise<EffectivePolicy> {
  const candidates = await tx.bookingPolicy.findMany({
    where: {
      orgId,
      isActive: true,
      OR: [
        { buildingId, resourceType },
        { buildingId, resourceType: null },
        { buildingId: null, resourceType },
        { buildingId: null, resourceType: null },
      ],
    },
  });
  const score = (p: BookingPolicy) => (p.buildingId ? 2 : 0) + (p.resourceType ? 1 : 0);
  candidates.sort((a, b) => score(b) - score(a) || b.updatedAt.getTime() - a.updatedAt.getTime());
  if (candidates[0]) return candidates[0];
  return {
    ...DEFAULT_POLICY,
    id: 'default',
    orgId,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}
