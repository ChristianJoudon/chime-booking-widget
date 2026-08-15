BEGIN;

ALTER TABLE chime_app.staff_members
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chime_staff_members_version_positive'
       AND conrelid = 'chime_app.staff_members'::regclass
  ) THEN
    ALTER TABLE chime_app.staff_members
      ADD CONSTRAINT chime_staff_members_version_positive CHECK (version > 0);
  END IF;
END
$$;

COMMIT;
