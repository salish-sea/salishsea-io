-- Take back what Supabase's default privileges handed out (bd salish-5of).
--
-- 20260909180000 granted INSERT on named columns only, so that a client could
-- not set `notified_at` — the notifier skips rows where it is non-NULL, so a
-- report submitted pre-marked as handled would never be filed. That grant was
-- correct and did nothing, because it was additive on top of a table-wide grant
-- that already existed before the GRANT ran.
--
-- The table-wide grant comes from ALTER DEFAULT PRIVILEGES, and this is where
-- local and production disagree — which is why it passed every local check:
--
--   local  default ACL for postgres in public:  anon=Dxtm/postgres
--   prod   default ACL for postgres in public:  anon=arwdDxtm/postgres
--
-- `a`, `r`, `w`, `d` are INSERT, SELECT, UPDATE and DELETE. The local stack has
-- had them removed from its defaults; production has not. So `CREATE TABLE
-- public.feedback` granted anon and authenticated full read/write in production
-- the moment it ran, and `SET ROLE anon; INSERT ... notified_at` was refused
-- locally and accepted in prod. Verified against production on 2026-09-10,
-- inside a transaction that was rolled back.
--
-- REVOKE first, then re-grant, so the result does not depend on what the
-- defaults happened to be. Nothing here is conditional on the environment.
--
-- The same default applies to every table this project has created in `public`,
-- so this is one instance of a wider problem; bd salish-6j6 carries that.

REVOKE ALL ON public.feedback FROM anon, authenticated;

-- Exactly as 20260909180000 intended: the client writes what a person typed and
-- the context their browser reported, and nothing else. `id` and `created_at`
-- take their defaults; `notified_at` and `github_issue` belong to the notifier.
GRANT INSERT (
  name, email, message, page_url, user_agent, release, user_uuid
) ON public.feedback TO anon, authenticated;

-- No SELECT, deliberately: feedback carries a name, an email and whatever the
-- person chose to type, and none of it belongs to any other visitor. RLS
-- already withheld the rows (there is no SELECT policy), but a grant nobody
-- needs is a grant that only matters when a policy is later added by mistake.
