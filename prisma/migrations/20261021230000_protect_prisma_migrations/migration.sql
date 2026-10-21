-- Keep Prisma's migration history out of Supabase's REST API too.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
