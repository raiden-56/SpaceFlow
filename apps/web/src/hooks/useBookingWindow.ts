// Resolves the shared booking context into concrete ISO instants in the selected building's
// timezone, and keeps a sensible default building/floor selected.
import { useEffect, useMemo } from 'react';
import { useAppDispatch, useAppSelector } from '@/store';
import { setBuilding, setFloor } from '@/store/bookingSlice';
import { useBuildingsQuery, useFloorsQuery } from '@/services/endpoints';
import { useAuth } from './useAuth';
import { toIso } from '@/utils/time';

export function useBookingWindow() {
  const dispatch = useAppDispatch();
  const ctx = useAppSelector((s) => s.booking);
  const { user } = useAuth();
  const { data: buildings, isLoading: buildingsLoading } = useBuildingsQuery();
  const building = buildings?.find((b) => b.id === ctx.buildingId) ?? null;
  const { data: floors, isLoading: floorsLoading } = useFloorsQuery({ buildingId: ctx.buildingId! }, { skip: !ctx.buildingId });
  const floor = floors?.find((f) => f.id === ctx.floorId) ?? null;

  // Default building: preference > home building > first active.
  useEffect(() => {
    if (!buildings?.length || ctx.buildingId) return;
    const preferred = user?.preferences.defaultBuildingId ?? user?.homeBuildingId;
    const pick = buildings.find((b) => b.id === preferred) ?? buildings[0];
    dispatch(setBuilding(pick.id));
  }, [buildings, ctx.buildingId, user, dispatch]);

  // Default floor: preference > first published floor with seats. Skipped when the user
  // explicitly picked "Whole building".
  useEffect(() => {
    if (!floors?.length || ctx.floorId || ctx.wholeBuilding) return;
    const preferred = floors.find((f) => f.id === user?.preferences.defaultFloorId);
    const pick = preferred ?? floors.find((f) => f.seatCount > 0) ?? floors[0];
    dispatch(setFloor(pick.id));
  }, [floors, ctx.floorId, ctx.wholeBuilding, user, dispatch]);

  const tz = building?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const window = useMemo(() => {
    const start = ctx.allDay ? '08:00' : ctx.startTime;
    const end = ctx.allDay ? '18:00' : ctx.endTime;
    return { startAt: toIso(ctx.date, start, tz), endAt: toIso(ctx.date, end, tz), startTime: start, endTime: end };
  }, [ctx.date, ctx.startTime, ctx.endTime, ctx.allDay, tz]);

  return { ...ctx, building, buildings: buildings ?? [], floors: floors ?? [], floor, tz, ...window, loading: buildingsLoading || floorsLoading };
}
