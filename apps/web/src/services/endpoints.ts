// Typed RTK Query endpoints for the whole SpaceFlow API. Tag invalidation keeps every view in
// sync after a mutation; realtime SSE events additionally invalidate tags (see realtime.ts).
import type {
  AdminOverviewDto,
  AdminUserDto,
  AmenityDto,
  AnnouncementDto,
  AssetDto,
  AuditLogDto,
  AuthResponseDto,
  BatchReservationResultDto,
  BuildingDto,
  BuildingInput,
  CurrentUserDto,
  DashboardDto,
  DepartmentDto,
  FavoriteDto,
  FloorDto,
  FloorMapDto,
  FloorPlanUpsertInput,
  IntegrationDto,
  LoginInput,
  MapObjectDto,
  NotificationDto,
  Paginated,
  PolicyDto,
  PolicyInput,
  ReservationCreateInput,
  ReservationDto,
  ReservationListQuery,
  ReservationSummaryDto,
  ReservationUpdateInput,
  ResourceAvailabilityDto,
  ResourceDayAvailabilityDto,
  ResourceDto,
  ResourceListQuery,
  RoomInput,
  SearchResultsDto,
  SeatInput,
  UpdatePreferencesInput,
  UserSummaryDto,
  ZoneDto,
} from '@spaceflow/shared';
import { api } from './api';
import { sessionEnded, sessionStarted, userUpdated } from '@/store/authSlice';

type Q = Record<string, string | number | boolean | string[] | undefined>;
function qs(params: Q): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === null) continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** A teammate's seat for a window (GET /resources/teammates). */
export interface TeammateSeatDto {
  userId: string;
  displayName: string;
  initials: string;
  isMe: boolean;
  checkedIn: boolean;
  resourceId: string;
  resourceCode: string;
  floorId: string;
  floorName: string;
  startAt: string;
  endAt: string;
}

export interface FloorPlanDraftDto {
  plan: { id: string; widthM: number; depthM: number; status: 'DRAFT' | 'PUBLISHED'; version: number; imageAssetId: string | null; modelAssetId: string | null; publishedAt: string | null } | null;
  objects: MapObjectDto[];
  zones: ZoneDto[];
  resources: { id: string; code: string; name: string; type: 'SEAT' | 'MEETING_ROOM'; linked: boolean }[];
}

export const endpoints = api.injectEndpoints({
  endpoints: (b) => ({
    // ---------------- Auth ----------------
    login: b.mutation<AuthResponseDto, LoginInput>({
      query: (body) => ({ url: '/auth/login', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled;
        dispatch(sessionStarted({ accessToken: data.accessToken, user: data.user }));
      },
    }),
    logout: b.mutation<void, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        try {
          await queryFulfilled;
        } finally {
          dispatch(sessionEnded());
          dispatch(api.util.resetApiState());
        }
      },
    }),
    me: b.query<CurrentUserDto, void>({ query: () => '/auth/me', providesTags: ['Me'] }),
    forgotPassword: b.mutation<{ ok: boolean; message: string }, { email: string }>({ query: (body) => ({ url: '/auth/forgot-password', method: 'POST', body }) }),
    resetPassword: b.mutation<{ ok: boolean }, { token: string; password: string }>({ query: (body) => ({ url: '/auth/reset-password', method: 'POST', body }) }),
    acceptInvite: b.mutation<AuthResponseDto, { token: string; password: string }>({
      query: (body) => ({ url: '/auth/accept-invite', method: 'POST', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled;
        dispatch(sessionStarted({ accessToken: data.accessToken, user: data.user }));
      },
    }),
    changePassword: b.mutation<{ ok: boolean }, { currentPassword: string; newPassword: string }>({ query: (body) => ({ url: '/auth/change-password', method: 'POST', body }) }),
    guestLogin: b.mutation<AuthResponseDto, void>({
      query: () => ({ url: '/auth/guest', method: 'POST' }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled;
        dispatch(sessionStarted({ accessToken: data.accessToken, user: data.user }));
      },
    }),
    guestStatus: b.query<{ enabled: boolean; sandboxTtlHours: number }, void>({ query: () => '/auth/guest/status' }),
    ssoStatus: b.query<{ enabled: boolean; provider: string | null }, void>({ query: () => '/auth/sso/status' }),

    // ---------------- Me ----------------
    updateProfile: b.mutation<CurrentUserDto, { firstName?: string; lastName?: string; phone?: string | null; jobTitle?: string | null }>({
      query: (body) => ({ url: '/users/me', method: 'PATCH', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled;
        dispatch(userUpdated(data));
      },
      invalidatesTags: ['Me'],
    }),
    updatePreferences: b.mutation<CurrentUserDto, UpdatePreferencesInput>({
      query: (body) => ({ url: '/users/me/preferences', method: 'PATCH', body }),
      async onQueryStarted(_arg, { dispatch, queryFulfilled }) {
        const { data } = await queryFulfilled;
        dispatch(userUpdated(data));
      },
      invalidatesTags: ['Me', 'Dashboard'],
    }),
    myReservations: b.query<Paginated<ReservationSummaryDto>, Partial<ReservationListQuery>>({
      query: (q) => `/users/me/reservations${qs(q as Q)}`,
      providesTags: (r) => [{ type: 'Reservations', id: 'MINE' }, ...(r?.items.map((i) => ({ type: 'Reservation' as const, id: i.id })) ?? [])],
    }),
    favorites: b.query<FavoriteDto[], void>({ query: () => '/users/me/favorites', providesTags: ['Favorites'] }),
    addFavorite: b.mutation<FavoriteDto, { resourceId: string }>({
      query: (body) => ({ url: '/users/me/favorites', method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => ['Favorites', 'Dashboard', { type: 'Resource', id: a.resourceId }, 'Resources', 'FloorMap'],
    }),
    removeFavorite: b.mutation<void, { resourceId: string }>({
      query: ({ resourceId }) => ({ url: `/users/me/favorites/${resourceId}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, a) => ['Favorites', 'Dashboard', { type: 'Resource', id: a.resourceId }, 'Resources', 'FloorMap'],
    }),
    notifications: b.query<Paginated<NotificationDto> & { unread: number }, { page?: number; pageSize?: number; unreadOnly?: boolean }>({
      query: (q) => `/users/me/notifications${qs(q as Q)}`,
      providesTags: ['Notifications'],
    }),
    markNotificationRead: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/users/me/notifications/${id}/read`, method: 'POST' }), invalidatesTags: ['Notifications', 'Dashboard'] }),
    markAllNotificationsRead: b.mutation<void, void>({ query: () => ({ url: '/users/me/notifications/read-all', method: 'POST' }), invalidatesTags: ['Notifications', 'Dashboard'] }),
    deleteNotification: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/users/me/notifications/${id}`, method: 'DELETE' }), invalidatesTags: ['Notifications'] }),
    myAudit: b.query<{ id: string; action: string; ip: string | null; createdAt: string }[], void>({ query: () => '/users/me/audit', providesTags: ['Me'] }),
    recentResources: b.query<ResourceDto[], void>({ query: () => '/users/me/recent-resources', providesTags: ['Reservations'] }),
    directory: b.query<Paginated<UserSummaryDto>, { q?: string; page?: number; pageSize?: number; departmentId?: string; teamId?: string }>({ query: (q) => `/users/directory${qs(q as Q)}` }),
    colleagueToday: b.query<{ user: UserSummaryDto; shared: boolean; seat: { reservationId: string; startAt: string; endAt: string; resource: ResourceDto } | null }, { id: string }>({ query: ({ id }) => `/users/directory/${id}/today`, providesTags: ['Reservations'] }),
    dashboard: b.query<DashboardDto, { buildingId?: string; startAt?: string; endAt?: string }>({ query: (q) => `/dashboard${qs(q as Q)}`, providesTags: ['Dashboard', 'Reservations', 'Availability'] }),

    // ---------------- Workplace ----------------
    buildings: b.query<BuildingDto[], void>({ query: () => '/buildings', providesTags: ['Buildings'] }),
    building: b.query<BuildingDto, { id: string }>({ query: ({ id }) => `/buildings/${id}`, providesTags: (_r, _e, a) => [{ type: 'Buildings', id: a.id }] }),
    floors: b.query<FloorDto[], { buildingId: string }>({ query: ({ buildingId }) => `/buildings/${buildingId}/floors`, providesTags: (_r, _e, a) => [{ type: 'Floors', id: a.buildingId }, 'Floors'] }),
    floorMap: b.query<FloorMapDto, { floorId: string; startAt?: string; endAt?: string }>({
      query: ({ floorId, startAt, endAt }) => `/floors/${floorId}/map${qs({ startAt, endAt })}`,
      providesTags: (_r, _e, a) => [{ type: 'FloorMap', id: a.floorId }, 'FloorMap', 'Availability'],
    }),
    resources: b.query<Paginated<ResourceDto>, Partial<ResourceListQuery>>({
      query: (q) => `/resources${qs(q as Q)}`,
      providesTags: (r) => ['Resources', 'Availability', ...(r?.items.map((i) => ({ type: 'Resource' as const, id: i.id })) ?? [])],
    }),
    resource: b.query<ResourceDto, { id: string; startAt?: string; endAt?: string }>({
      query: ({ id, startAt, endAt }) => `/resources/${id}${qs({ startAt, endAt })}`,
      providesTags: (_r, _e, a) => [{ type: 'Resource', id: a.id }, 'Availability'],
    }),
    resourceDay: b.query<ResourceDayAvailabilityDto, { id: string; date: string; slotMinutes?: number }>({
      query: ({ id, date, slotMinutes }) => `/resources/${id}/availability${qs({ date, slotMinutes })}`,
      providesTags: (_r, _e, a) => [{ type: 'Resource', id: a.id }, 'Availability'],
    }),
    availability: b.query<{ startAt: string; endAt: string; items: ResourceAvailabilityDto[] }, { floorId?: string; buildingId?: string; resourceIds?: string[]; type?: 'SEAT' | 'MEETING_ROOM'; startAt: string; endAt: string }>({
      query: (q) => `/resources/availability${qs(q as Q)}`,
      providesTags: ['Availability'],
    }),
    suggestSeats: b.query<(ResourceDto & { availability?: ResourceAvailabilityDto })[], { buildingId?: string; floorId?: string; startAt: string; endAt: string; limit?: number }>({
      query: (q) => `/resources/suggest${qs(q as Q)}`,
      providesTags: ['Availability'],
    }),
    teammates: b.query<TeammateSeatDto[], { buildingId?: string; floorId?: string; startAt: string; endAt: string }>({
      query: (q) => `/resources/teammates${qs(q as Q)}`,
      providesTags: ['Availability', 'Reservations'],
    }),
    amenities: b.query<AmenityDto[], void>({ query: () => '/amenities', providesTags: ['Amenities'] }),
    search: b.query<SearchResultsDto, { q: string; limit?: number }>({ query: (q) => `/search${qs(q as Q)}`, providesTags: ['Search'] }),
    resourceReservations: b.query<ReservationSummaryDto[], { id: string }>({ query: ({ id }) => `/resources/${id}/reservations`, providesTags: ['Reservations'] }),
    maintenanceWindows: b.query<{ id: string; startAt: string; endAt: string; reason: string | null }[], { id: string }>({ query: ({ id }) => `/resources/${id}/maintenance`, providesTags: (_r, _e, a) => [{ type: 'Resource', id: a.id }] }),
    addMaintenance: b.mutation<unknown, { id: string; startAt: string; endAt: string; reason?: string }>({ query: ({ id, ...body }) => ({ url: `/resources/${id}/maintenance`, method: 'POST', body }), invalidatesTags: (_r, _e, a) => [{ type: 'Resource', id: a.id }, 'Availability', 'FloorMap', 'Resources'] }),
    removeMaintenance: b.mutation<void, { id: string; windowId: string }>({ query: ({ id, windowId }) => ({ url: `/resources/${id}/maintenance/${windowId}`, method: 'DELETE' }), invalidatesTags: (_r, _e, a) => [{ type: 'Resource', id: a.id }, 'Availability', 'FloorMap'] }),

    // ---------------- Reservations ----------------
    reservation: b.query<ReservationDto, { id: string }>({ query: ({ id }) => `/reservations/${id}`, providesTags: (_r, _e, a) => [{ type: 'Reservation', id: a.id }] }),
    reservations: b.query<Paginated<ReservationSummaryDto>, Partial<ReservationListQuery>>({ query: (q) => `/reservations${qs(q as Q)}`, providesTags: ['Reservations'] }),
    createReservation: b.mutation<BatchReservationResultDto, ReservationCreateInput>({
      query: (body) => ({ url: '/reservations', method: 'POST', body }),
      invalidatesTags: ['Reservations', 'Availability', 'FloorMap', 'Resources', 'Dashboard', 'Notifications', 'Resource'],
    }),
    updateReservation: b.mutation<ReservationDto, { id: string } & ReservationUpdateInput>({
      query: ({ id, ...body }) => ({ url: `/reservations/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Reservation', id: a.id }, 'Reservations', 'Availability', 'FloorMap', 'Resources', 'Dashboard', 'Resource'],
    }),
    cancelReservation: b.mutation<ReservationDto, { id: string; reason?: string; cancelSeries?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/reservations/${id}/cancel`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Reservation', id: a.id }, 'Reservations', 'Availability', 'FloorMap', 'Resources', 'Dashboard', 'Resource'],
    }),
    checkIn: b.mutation<ReservationDto, { id: string; code?: string }>({
      query: ({ id, ...body }) => ({ url: `/reservations/${id}/check-in`, method: 'POST', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Reservation', id: a.id }, 'Reservations', 'Availability', 'FloorMap', 'Dashboard'],
    }),
    checkOut: b.mutation<ReservationDto, { id: string }>({
      query: ({ id }) => ({ url: `/reservations/${id}/check-out`, method: 'POST' }),
      invalidatesTags: (_r, _e, a) => [{ type: 'Reservation', id: a.id }, 'Reservations', 'Availability', 'FloorMap', 'Dashboard'],
    }),
    reservationQr: b.query<{ reservationId: string; code: string; url: string; dataUrl: string }, { id: string }>({ query: ({ id }) => `/reservations/${id}/qr` }),
    approvals: b.query<Paginated<ReservationSummaryDto>, { page?: number; pageSize?: number }>({ query: (q) => `/reservations/approvals${qs(q as Q)}`, providesTags: ['Approvals'] }),
    decideApproval: b.mutation<ReservationDto, { id: string; decision: 'APPROVED' | 'REJECTED'; note?: string }>({
      query: ({ id, ...body }) => ({ url: `/reservations/${id}/approval`, method: 'POST', body }),
      invalidatesTags: ['Approvals', 'Reservations', 'Availability', 'FloorMap', 'Analytics'],
    }),

    // ---------------- Admin: workplace ----------------
    createBuilding: b.mutation<BuildingDto, BuildingInput>({ query: (body) => ({ url: '/admin/buildings', method: 'POST', body }), invalidatesTags: ['Buildings', 'Analytics'] }),
    updateBuilding: b.mutation<BuildingDto, { id: string } & Partial<BuildingInput>>({ query: ({ id, ...body }) => ({ url: `/admin/buildings/${id}`, method: 'PATCH', body }), invalidatesTags: ['Buildings'] }),
    setBuildingModel: b.mutation<BuildingDto, { id: string; modelAssetId: string | null }>({ query: ({ id, ...body }) => ({ url: `/admin/buildings/${id}/model`, method: 'PUT', body }), invalidatesTags: ['Buildings'] }),
    deleteBuilding: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/admin/buildings/${id}`, method: 'DELETE' }), invalidatesTags: ['Buildings', 'Floors', 'Analytics'] }),
    createFloor: b.mutation<FloorDto, { buildingId: string; name: string; number: number; isPublished?: boolean }>({ query: ({ buildingId, ...body }) => ({ url: `/admin/buildings/${buildingId}/floors`, method: 'POST', body }), invalidatesTags: ['Floors', 'Buildings', 'Analytics'] }),
    updateFloor: b.mutation<FloorDto, { id: string; name?: string; number?: number; isPublished?: boolean; sortOrder?: number }>({ query: ({ id, ...body }) => ({ url: `/admin/floors/${id}`, method: 'PATCH', body }), invalidatesTags: ['Floors', 'FloorMap', 'Buildings'] }),
    reorderFloors: b.mutation<void, { buildingId: string; floorIds: string[] }>({ query: ({ buildingId, ...body }) => ({ url: `/admin/buildings/${buildingId}/floors/reorder`, method: 'POST', body }), invalidatesTags: ['Floors'] }),
    deleteFloor: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/admin/floors/${id}`, method: 'DELETE' }), invalidatesTags: ['Floors', 'Buildings', 'Analytics'] }),
    floorPlanDraft: b.query<FloorPlanDraftDto, { floorId: string }>({ query: ({ floorId }) => `/admin/floors/${floorId}/plan`, providesTags: (_r, _e, a) => [{ type: 'FloorPlan', id: a.floorId }] }),
    saveFloorPlan: b.mutation<FloorPlanDraftDto & { linked: number; unlinkedResources: string[] }, { floorId: string } & FloorPlanUpsertInput>({
      query: ({ floorId, ...body }) => ({ url: `/admin/floors/${floorId}/plan`, method: 'PUT', body }),
      invalidatesTags: (_r, _e, a) => [{ type: 'FloorPlan', id: a.floorId }, 'FloorMap', 'Floors', 'Resources'],
    }),
    publishFloorPlan: b.mutation<{ ok: boolean; version: number; warnings: string[] }, { floorId: string }>({ query: ({ floorId }) => ({ url: `/admin/floors/${floorId}/plan/publish`, method: 'POST' }), invalidatesTags: (_r, _e, a) => [{ type: 'FloorPlan', id: a.floorId }, 'Floors', 'FloorMap', 'Buildings'] }),
    unpublishFloorPlan: b.mutation<{ ok: boolean }, { floorId: string }>({ query: ({ floorId }) => ({ url: `/admin/floors/${floorId}/plan/unpublish`, method: 'POST' }), invalidatesTags: (_r, _e, a) => [{ type: 'FloorPlan', id: a.floorId }, 'Floors', 'FloorMap', 'Buildings'] }),
    zones: b.query<ZoneDto[], { floorId: string }>({ query: ({ floorId }) => `/admin/floors/${floorId}/zones`, providesTags: ['Zones'] }),
    createZone: b.mutation<ZoneDto, { floorId: string; name: string; kind?: string; color?: string | null }>({ query: ({ floorId, ...body }) => ({ url: `/admin/floors/${floorId}/zones`, method: 'POST', body }), invalidatesTags: ['Zones', 'FloorMap', 'FloorPlan'] }),
    updateZone: b.mutation<ZoneDto, { id: string; name?: string; kind?: string; color?: string | null }>({ query: ({ id, ...body }) => ({ url: `/admin/zones/${id}`, method: 'PATCH', body }), invalidatesTags: ['Zones', 'FloorMap', 'FloorPlan'] }),
    deleteZone: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/admin/zones/${id}`, method: 'DELETE' }), invalidatesTags: ['Zones', 'FloorMap', 'FloorPlan', 'Resources'] }),
    createSeat: b.mutation<ResourceDto, SeatInput>({ query: (body) => ({ url: '/seats', method: 'POST', body }), invalidatesTags: ['Resources', 'FloorMap', 'FloorPlan', 'Floors', 'Buildings', 'Analytics'] }),
    updateSeat: b.mutation<ResourceDto, { id: string } & Partial<SeatInput>>({ query: ({ id, ...body }) => ({ url: `/seats/${id}`, method: 'PATCH', body }), invalidatesTags: (_r, _e, a) => [{ type: 'Resource', id: a.id }, 'Resources', 'FloorMap', 'Availability'] }),
    deleteSeat: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/seats/${id}`, method: 'DELETE' }), invalidatesTags: ['Resources', 'FloorMap', 'FloorPlan', 'Floors', 'Buildings', 'Analytics'] }),
    createRoom: b.mutation<ResourceDto, RoomInput>({ query: (body) => ({ url: '/meeting-rooms', method: 'POST', body }), invalidatesTags: ['Resources', 'FloorMap', 'FloorPlan', 'Floors', 'Buildings', 'Analytics'] }),
    updateRoom: b.mutation<ResourceDto, { id: string } & Partial<RoomInput>>({ query: ({ id, ...body }) => ({ url: `/meeting-rooms/${id}`, method: 'PATCH', body }), invalidatesTags: (_r, _e, a) => [{ type: 'Resource', id: a.id }, 'Resources', 'FloorMap', 'Availability'] }),
    deleteRoom: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/meeting-rooms/${id}`, method: 'DELETE' }), invalidatesTags: ['Resources', 'FloorMap', 'FloorPlan', 'Floors', 'Buildings', 'Analytics'] }),
    bulkUpdateResources: b.mutation<{ updated: number }, { resourceIds: string[]; patch: Record<string, unknown> }>({ query: (body) => ({ url: '/resources/bulk', method: 'POST', body }), invalidatesTags: ['Resources', 'FloorMap', 'Availability'] }),
    createAmenity: b.mutation<AmenityDto, { code: string; name: string; category?: string; icon?: string | null }>({ query: (body) => ({ url: '/admin/amenities', method: 'POST', body }), invalidatesTags: ['Amenities'] }),
    updateAmenity: b.mutation<AmenityDto, { id: string; code?: string; name?: string; category?: string; icon?: string | null }>({ query: ({ id, ...body }) => ({ url: `/admin/amenities/${id}`, method: 'PATCH', body }), invalidatesTags: ['Amenities', 'Resources'] }),
    deleteAmenity: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/admin/amenities/${id}`, method: 'DELETE' }), invalidatesTags: ['Amenities', 'Resources'] }),
    adminAnnouncements: b.query<AnnouncementDto[], void>({ query: () => '/admin/announcements', providesTags: ['Announcements'] }),
    createAnnouncement: b.mutation<AnnouncementDto, { title: string; body: string; buildingId?: string | null; expiresAt?: string | null }>({ query: (body) => ({ url: '/admin/announcements', method: 'POST', body }), invalidatesTags: ['Announcements', 'Dashboard'] }),
    deleteAnnouncement: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/admin/announcements/${id}`, method: 'DELETE' }), invalidatesTags: ['Announcements', 'Dashboard'] }),
    importResources: b.mutation<{ dryRun: boolean; valid: number; errors: { row: number; message: string }[]; created: number; updated: number }, { buildingId: string; file: File; type: 'seats' | 'rooms'; dryRun: boolean }>({
      query: ({ buildingId, file, type, dryRun }) => {
        const form = new FormData();
        form.append('file', file);
        form.append('type', type);
        form.append('dryRun', String(dryRun));
        return { url: `/admin/buildings/${buildingId}/import`, method: 'POST', body: form };
      },
      invalidatesTags: ['Resources', 'FloorMap', 'FloorPlan', 'Floors', 'Buildings', 'Analytics'],
    }),
    assets: b.query<AssetDto[], void>({ query: () => '/assets', providesTags: ['Assets'] }),
    uploadAsset: b.mutation<AssetDto, { file: File; kind: 'BUILDING_MODEL' | 'FLOOR_MODEL' | 'FLOOR_PLAN_IMAGE' }>({
      query: ({ file, kind }) => {
        const form = new FormData();
        form.append('file', file);
        form.append('kind', kind);
        return { url: '/assets', method: 'POST', body: form };
      },
      invalidatesTags: ['Assets'],
    }),
    deleteAsset: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/assets/${id}`, method: 'DELETE' }), invalidatesTags: ['Assets'] }),

    // ---------------- Admin: people ----------------
    adminUsers: b.query<Paginated<AdminUserDto>, { q?: string; page?: number; pageSize?: number; departmentId?: string; teamId?: string; role?: string; status?: string }>({ query: (q) => `/admin/users${qs(q as Q)}`, providesTags: ['AdminUsers'] }),
    adminUser: b.query<AdminUserDto, { id: string }>({ query: ({ id }) => `/admin/users/${id}`, providesTags: (_r, _e, a) => [{ type: 'AdminUsers', id: a.id }] }),
    createUser: b.mutation<AdminUserDto, Record<string, unknown>>({ query: (body) => ({ url: '/admin/users', method: 'POST', body }), invalidatesTags: ['AdminUsers', 'Departments', 'Analytics'] }),
    updateUser: b.mutation<AdminUserDto, { id: string } & Record<string, unknown>>({ query: ({ id, ...body }) => ({ url: `/admin/users/${id}`, method: 'PATCH', body }), invalidatesTags: ['AdminUsers', 'Departments'] }),
    deleteUser: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/admin/users/${id}`, method: 'DELETE' }), invalidatesTags: ['AdminUsers', 'Departments', 'Analytics'] }),
    inviteUser: b.mutation<{ ok: boolean; inviteUrl: string }, { id: string }>({ query: ({ id }) => ({ url: `/admin/users/${id}/invite`, method: 'POST' }), invalidatesTags: ['AdminUsers'] }),
    userReservations: b.query<Paginated<ReservationSummaryDto>, { id: string } & Partial<ReservationListQuery>>({ query: ({ id, ...q }) => `/admin/users/${id}/reservations${qs(q as Q)}`, providesTags: ['Reservations'] }),
    departments: b.query<DepartmentDto[], void>({ query: () => '/admin/departments', providesTags: ['Departments'] }),
    createDepartment: b.mutation<DepartmentDto, { name: string }>({ query: (body) => ({ url: '/admin/departments', method: 'POST', body }), invalidatesTags: ['Departments'] }),
    updateDepartment: b.mutation<DepartmentDto, { id: string; name: string }>({ query: ({ id, ...body }) => ({ url: `/admin/departments/${id}`, method: 'PATCH', body }), invalidatesTags: ['Departments'] }),
    deleteDepartment: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/admin/departments/${id}`, method: 'DELETE' }), invalidatesTags: ['Departments', 'AdminUsers'] }),
    createTeam: b.mutation<unknown, { name: string; departmentId: string }>({ query: (body) => ({ url: '/admin/teams', method: 'POST', body }), invalidatesTags: ['Departments'] }),
    updateTeam: b.mutation<unknown, { id: string; name?: string; departmentId?: string }>({ query: ({ id, ...body }) => ({ url: `/admin/teams/${id}`, method: 'PATCH', body }), invalidatesTags: ['Departments'] }),
    deleteTeam: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/admin/teams/${id}`, method: 'DELETE' }), invalidatesTags: ['Departments', 'AdminUsers'] }),

    // ---------------- Admin: governance ----------------
    policies: b.query<PolicyDto[], void>({ query: () => '/admin/policies', providesTags: ['Policies'] }),
    effectivePolicy: b.query<PolicyDto, { buildingId: string; resourceType: 'SEAT' | 'MEETING_ROOM' }>({ query: (q) => `/admin/policies/effective${qs(q as Q)}`, providesTags: ['Policies'] }),
    createPolicy: b.mutation<PolicyDto, Partial<PolicyInput>>({ query: (body) => ({ url: '/admin/policies', method: 'POST', body }), invalidatesTags: ['Policies'] }),
    updatePolicy: b.mutation<PolicyDto, { id: string } & Partial<PolicyInput>>({ query: ({ id, ...body }) => ({ url: `/admin/policies/${id}`, method: 'PATCH', body }), invalidatesTags: ['Policies'] }),
    deletePolicy: b.mutation<void, { id: string }>({ query: ({ id }) => ({ url: `/admin/policies/${id}`, method: 'DELETE' }), invalidatesTags: ['Policies'] }),
    adminReservations: b.query<Paginated<ReservationSummaryDto>, Partial<ReservationListQuery>>({ query: (q) => `/admin/reservations${qs(q as Q)}`, providesTags: ['Reservations'] }),
    adminCancelReservation: b.mutation<ReservationDto, { id: string; reason: string }>({ query: ({ id, ...body }) => ({ url: `/admin/reservations/${id}/cancel`, method: 'POST', body }), invalidatesTags: ['Reservations', 'Availability', 'FloorMap', 'Analytics', 'Audit'] }),
    reservationCheckIns: b.query<{ id: string; kind: string; method: string; at: string; by: string | null }[], { id: string }>({ query: ({ id }) => `/admin/reservations/${id}/check-ins` }),
    reservationConflicts: b.query<{ reservations: { id: string; status: string; startAt: string; endAt: string; user: string; email: string; createdAt: string }[]; audit: { id: string; action: string; entityId: string; createdAt: string; after: unknown }[] }, { resourceId: string; from?: string; to?: string }>({ query: (q) => `/admin/reservations/conflicts${qs(q as Q)}` }),
    analyticsOverview: b.query<AdminOverviewDto, { buildingId?: string; from?: string; to?: string }>({ query: (q) => `/admin/analytics/overview${qs(q as Q)}`, providesTags: ['Analytics', 'Reservations'] }),
    auditLog: b.query<Paginated<AuditLogDto>, { page?: number; pageSize?: number; entityType?: string; entityId?: string; actorId?: string; action?: string; from?: string; to?: string }>({ query: (q) => `/admin/audit${qs(q as Q)}`, providesTags: ['Audit'] }),
    integrations: b.query<IntegrationDto[], void>({ query: () => '/admin/integrations', providesTags: ['Integrations'] }),
    updateIntegration: b.mutation<IntegrationDto[], { provider: string; isEnabled: boolean; config?: Record<string, unknown> }>({ query: (body) => ({ url: '/admin/integrations', method: 'PUT', body }), invalidatesTags: ['Integrations'] }),
    orgSettings: b.query<{ id: string; name: string; slug: string; timezone: string; settings: Record<string, unknown> }, void>({ query: () => '/admin/settings', providesTags: ['Settings'] }),
    updateOrgSettings: b.mutation<unknown, { name?: string; timezone?: string; settings?: Record<string, unknown> }>({ query: (body) => ({ url: '/admin/settings', method: 'PATCH', body }), invalidatesTags: ['Settings'] }),
  }),
  overrideExisting: false,
});

export const {
  useLoginMutation,
  useLogoutMutation,
  useMeQuery,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useAcceptInviteMutation,
  useChangePasswordMutation,
  useSsoStatusQuery,
  useGuestLoginMutation,
  useGuestStatusQuery,
  useUpdateProfileMutation,
  useUpdatePreferencesMutation,
  useMyReservationsQuery,
  useFavoritesQuery,
  useAddFavoriteMutation,
  useRemoveFavoriteMutation,
  useNotificationsQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
  useDeleteNotificationMutation,
  useRecentResourcesQuery,
  useMyAuditQuery,
  useDirectoryQuery,
  useColleagueTodayQuery,
  useDashboardQuery,
  useBuildingsQuery,
  useBuildingQuery,
  useFloorsQuery,
  useFloorMapQuery,
  useResourcesQuery,
  useLazyResourcesQuery,
  useResourceQuery,
  useResourceDayQuery,
  useAvailabilityQuery,
  useSuggestSeatsQuery,
  useAmenitiesQuery,
  useTeammatesQuery,
  useSearchQuery,
  useLazySearchQuery,
  useResourceReservationsQuery,
  useMaintenanceWindowsQuery,
  useAddMaintenanceMutation,
  useRemoveMaintenanceMutation,
  useReservationQuery,
  useReservationsQuery,
  useCreateReservationMutation,
  useUpdateReservationMutation,
  useCancelReservationMutation,
  useCheckInMutation,
  useCheckOutMutation,
  useReservationQrQuery,
  useApprovalsQuery,
  useDecideApprovalMutation,
  useCreateBuildingMutation,
  useUpdateBuildingMutation,
  useSetBuildingModelMutation,
  useDeleteBuildingMutation,
  useCreateFloorMutation,
  useUpdateFloorMutation,
  useReorderFloorsMutation,
  useDeleteFloorMutation,
  useFloorPlanDraftQuery,
  useSaveFloorPlanMutation,
  usePublishFloorPlanMutation,
  useUnpublishFloorPlanMutation,
  useZonesQuery,
  useCreateZoneMutation,
  useUpdateZoneMutation,
  useDeleteZoneMutation,
  useCreateSeatMutation,
  useUpdateSeatMutation,
  useDeleteSeatMutation,
  useCreateRoomMutation,
  useUpdateRoomMutation,
  useDeleteRoomMutation,
  useBulkUpdateResourcesMutation,
  useCreateAmenityMutation,
  useUpdateAmenityMutation,
  useDeleteAmenityMutation,
  useAdminAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useDeleteAnnouncementMutation,
  useImportResourcesMutation,
  useAssetsQuery,
  useUploadAssetMutation,
  useDeleteAssetMutation,
  useAdminUsersQuery,
  useAdminUserQuery,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,
  useInviteUserMutation,
  useUserReservationsQuery,
  useDepartmentsQuery,
  useCreateDepartmentMutation,
  useUpdateDepartmentMutation,
  useDeleteDepartmentMutation,
  useCreateTeamMutation,
  useUpdateTeamMutation,
  useDeleteTeamMutation,
  usePoliciesQuery,
  useEffectivePolicyQuery,
  useCreatePolicyMutation,
  useUpdatePolicyMutation,
  useDeletePolicyMutation,
  useAdminReservationsQuery,
  useAdminCancelReservationMutation,
  useReservationCheckInsQuery,
  useReservationConflictsQuery,
  useAnalyticsOverviewQuery,
  useAuditLogQuery,
  useIntegrationsQuery,
  useUpdateIntegrationMutation,
  useOrgSettingsQuery,
  useUpdateOrgSettingsMutation,
} = endpoints;
