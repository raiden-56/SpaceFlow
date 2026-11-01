-- btree_gist is required for the reservation exclusion constraint (resource_id = AND tstzrange &&).
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Isolated database for automated tests.
CREATE DATABASE spaceflow_test;
\connect spaceflow_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
