import { useMemo } from 'react';
import { useAmenitiesQuery, useBuildingsQuery, useDepartmentsQuery, useFloorsQuery, useZonesQuery } from '@/services/endpoints';

/** Buildings / floors / zones / amenities lookups used by admin forms and filters. */
export function useLookups(buildingId?: string | null, floorId?: string | null) {
  const buildings = useBuildingsQuery();
  const floors = useFloorsQuery({ buildingId: buildingId ?? '' }, { skip: !buildingId });
  const zones = useZonesQuery({ floorId: floorId ?? '' }, { skip: !floorId });
  const amenities = useAmenitiesQuery();
  const building = useMemo(() => buildings.data?.find((b) => b.id === buildingId) ?? null, [buildings.data, buildingId]);
  return {
    buildings: buildings.data ?? [],
    building,
    floors: floors.data ?? [],
    zones: zones.data ?? [],
    amenities: amenities.data ?? [],
    loading: buildings.isLoading || floors.isLoading || zones.isLoading || amenities.isLoading,
  };
}

export function useDepartmentsLookup() {
  const { data } = useDepartmentsQuery();
  return data ?? [];
}

export const TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Helsinki',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Australia/Sydney',
  'Australia/Melbourne',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Africa/Johannesburg',
];
