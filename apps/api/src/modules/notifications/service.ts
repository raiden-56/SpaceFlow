import type { NotificationType, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { sendToUser } from '../../realtime/sse.js';
import { emailProvider } from '../../integrations/email.js';
import { env } from '../../config/env.js';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Also send an email when the user has email notifications enabled. */
  email?: boolean;
}

/**
 * Creates an in-app notification, pushes it over SSE, and optionally emails the user.
 * Safe to call inside a transaction (pass tx); the SSE push + email happen after creation.
 */
export async function notify(input: NotifyInput, tx: Tx | typeof prisma = prisma) {
  const row = await tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: (input.data as Prisma.InputJsonObject | undefined) ?? undefined,
    },
  });
  // Fire-and-forget delivery; never block the calling request.
  setImmediate(() => {
    sendToUser(input.userId, 'notification.created', {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      data: row.data,
      createdAt: row.createdAt.toISOString(),
    });
    if (input.email) void deliverEmail(input.userId, input.title, input.body);
  });
  return row;
}

async function deliverEmail(userId: string, subject: string, text: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true, preferences: { select: { emailNotifications: true } } },
    });
    if (!user || user.status !== 'ACTIVE') return;
    if (user.preferences && !user.preferences.emailNotifications) return;
    await emailProvider.send({
      to: user.email,
      subject: `[SpaceFlow] ${subject}`,
      text: `${text}\n\nOpen SpaceFlow: ${env.webOrigins[0]}`,
    });
  } catch (err) {
    logger.warn({ err, userId }, 'email delivery failed');
  }
}
