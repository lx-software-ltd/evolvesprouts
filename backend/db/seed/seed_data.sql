-- Seed data placeholder (no initial data for asset tables)

-- System tag for assets linked to expenses (see migration 0014_add_asset_tags).
INSERT INTO tags (id, name, created_by)
SELECT gen_random_uuid(), 'expense_attachment', 'system'
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE lower(name) = lower('expense_attachment'));

-- Admin-assignable tag for client-facing asset documents (see admin asset client_tag field).
INSERT INTO tags (id, name, created_by)
SELECT gen_random_uuid(), 'client_document', 'system'
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE lower(name) = lower('client_document'));

-- System tag for assets linked to issued customer invoices (see migration 0077_invoice_assets).
INSERT INTO tags (id, name, created_by)
SELECT gen_random_uuid(), 'customer_invoice', 'system'
WHERE NOT EXISTS (SELECT 1 FROM tags WHERE lower(name) = lower('customer_invoice'));

-- Referral service keys on services (nullable column). Only set when exactly one row matches,
-- so seed never assigns the same key to multiple services.
UPDATE services s
SET service_key = 'my-best-auntie-training-course'
FROM (
  SELECT id
  FROM services
  WHERE service_key IS NULL
    AND service_type = 'training_course'
    AND (
      lower(title) LIKE '%best auntie%'
      OR lower(title) LIKE '%my best auntie%'
    )
) pick
WHERE s.id = pick.id
  AND (
    SELECT count(*)::int
    FROM services
    WHERE service_key IS NULL
      AND service_type = 'training_course'
      AND (
        lower(title) LIKE '%best auntie%'
        OR lower(title) LIKE '%my best auntie%'
      )
  ) = 1;

-- One-time corrective update if any row still has the pre-rename MBA key string.
UPDATE services s
SET service_key = 'my-best-auntie-training-course'
WHERE lower(trim(coalesce(s.service_key, ''))) = 'my-best-auntie'
  AND s.service_type = 'training_course'
  AND (
    lower(coalesce(s.title, '')) LIKE '%best auntie%'
    OR lower(coalesce(s.title, '')) LIKE '%my best auntie%'
  );

-- ───────────────────────────────────────────────────────────────────────
-- DEPENDENCY: requires migration `0059_intro_call_service_type`, which
-- adds the `intro_call` value to the `service_type` enum.
-- Run `alembic upgrade head` before applying this seed file.
-- ───────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'service_type' AND e.enumlabel = 'intro_call'
  ) THEN
    RAISE NOTICE 'Skipping intro-call seed: service_type.intro_call enum value missing. Run alembic upgrade head first.';
  ELSE
-- Free intro-call: service template (idempotent; requires service_type intro_call).
INSERT INTO services (
  id, service_type, title, service_key, booking_system, description,
  cover_image_s3_key, delivery_mode, status, created_by,
  service_tier, location_id
)
SELECT
  gen_random_uuid(),
  'intro_call',
  'Free 15-Minute Intro Call',
  'intro-call',
  'intro-call-booking',
  NULL,
  NULL,
  'online',
  'published',
  'seed',
  NULL,
  NULL
WHERE NOT EXISTS (
  SELECT 1 FROM services WHERE lower(service_key) = 'intro-call'
);

-- Consultation_details row for intro-call (free pricing, 15 minutes).
INSERT INTO consultation_details (
  service_id, consultation_format, duration_minutes, pricing_model, default_hourly_rate
)
SELECT
  s.id,
  'one_on_one',
  15,
  'free',
  NULL
FROM services s
WHERE lower(s.service_key) = 'intro-call'
  AND NOT EXISTS (
    SELECT 1 FROM consultation_details cd WHERE cd.service_id = s.id
  );

-- Service instance for intro-call.
INSERT INTO service_instances (
  id, service_id, slug, status, delivery_mode, created_by,
  eventbrite_sync_status, eventbrite_retry_count
)
SELECT
  gen_random_uuid(),
  s.id,
  'intro-call-free-15min',
  'open',
  'online',
  'seed',
  'pending',
  0
FROM services s
WHERE lower(s.service_key) = 'intro-call'
  AND NOT EXISTS (
    SELECT 1 FROM service_instances WHERE lower(slug) = 'intro-call-free-15min'
  );
  END IF;
END $$;

-- organizations.legal_name (migration 0071_partner_legal_name): no seed inserts into
-- organizations; partner legal names are admin-created at runtime.
