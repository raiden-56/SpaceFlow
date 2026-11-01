import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must include a letter')
  .regex(/\d/, 'Password must include a number');

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: z.string().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(10), password: passwordSchema });
export const acceptInviteSchema = z.object({ token: z.string().min(10), password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  phone: z.string().max(30).nullable().optional(),
  jobTitle: z.string().max(80).nullable().optional(),
});

export const updatePreferencesSchema = z.object({
  defaultBuildingId: z.string().uuid().nullable().optional(),
  defaultFloorId: z.string().uuid().nullable().optional(),
  shareLocationWithTeam: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  preferredView: z.enum(['3D', '2D', 'LIST']).optional(),
  reducedMotion: z.boolean().optional(),
});
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
