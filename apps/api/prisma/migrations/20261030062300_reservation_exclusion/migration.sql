-- Reservation integrity: no two active reservations may overlap on the same resource.
-- Uses a half-open tstzrange [start, end) so back-to-back bookings can share a boundary.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_valid_range" CHECK ("end_at" > "start_at");

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE ("status" IN ('PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'));

-- Maintenance windows must also be valid ranges.
ALTER TABLE "maintenance_windows"
  ADD CONSTRAINT "maintenance_windows_valid_range" CHECK ("end_at" > "start_at");

-- Trigram-free prefix/ILIKE search support for resources and users.
CREATE INDEX IF NOT EXISTS "resources_search_text_idx" ON "resources" (lower("search_text"));
CREATE INDEX IF NOT EXISTS "users_name_idx" ON "users" (lower("first_name"), lower("last_name"));
CREATE INDEX IF NOT EXISTS "reservations_active_resource_idx"
  ON "reservations" ("resource_id", "start_at")
  WHERE ("status" IN ('PENDING_APPROVAL', 'CONFIRMED', 'CHECKED_IN'));
