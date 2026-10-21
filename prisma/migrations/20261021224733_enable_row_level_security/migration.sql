-- Supabase exposes the public schema through its REST API (anon/authenticated roles).
-- RLS with no policies blocks that API entirely; the backend connects as the table owner and is unaffected.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "otps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "identity_records" ENABLE ROW LEVEL SECURITY;
