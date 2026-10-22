-- BVN/NIN records keep only what verification needs (plus phone and address shown by assistance).
-- IF EXISTS: databases that never had these columns (e.g. Supabase) are unaffected.
ALTER TABLE "identity_records" DROP COLUMN IF EXISTS "gender",
DROP COLUMN IF EXISTS "email",
DROP COLUMN IF EXISTS "state_of_origin",
DROP COLUMN IF EXISTS "state_of_residence",
DROP COLUMN IF EXISTS "town";
