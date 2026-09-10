-- Somewhere to put what a contributor tells us, that we own (bd salish-5of).
--
-- The feedback widget was Sentry's, so a report only arrived if the person's
-- browser could reach sentry.io. On 2026-09-08 one could not — twice, on two
-- different networks — and the report died in the form. It named three real
-- bugs (salish-8q9, salish-jo5, salish-16b) and reached us only because the
-- reporter screenshotted it before giving up. Sentry ingest hosts sit on
-- common tracker blocklists, so any content blocker silences the one channel a
-- contributor has for telling us something is broken.
--
-- This table is reachable whenever the rest of the app is, because it is the
-- same Supabase the map is already talking to. Decision 039.

CREATE TABLE public.feedback (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- What they told us. `message` is the only part that is any use on its own.
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email TEXT CHECK (email IS NULL OR length(email) BETWEEN 3 AND 320),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 5000),

  -- Context worth having and impossible to ask for. The 2026-09-08 report was
  -- iOS Safari specific and we could not tell, because nothing recorded it.
  page_url TEXT CHECK (page_url IS NULL OR length(page_url) <= 2000),
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 500),
  release TEXT CHECK (release IS NULL OR length(release) <= 100),

  -- Stamped from auth.uid() by submit_feedback, never sent by the client, so a
  -- signed-in report cannot claim to be from someone else. NULL for a stranger.
  user_uuid UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Bookkeeping for the notifier (.github/workflows/feedback-notify.yml): it
  -- files a GitHub issue for rows where notified_at IS NULL, then stamps them.
  -- Idempotent by construction — a re-run files nothing twice.
  notified_at TIMESTAMPTZ,
  github_issue INTEGER
);

CREATE INDEX feedback_unnotified ON public.feedback (created_at) WHERE notified_at IS NULL;

-- Anyone may submit; nobody may read.
--
-- No SELECT policy and no SELECT grant, deliberately: feedback carries a name,
-- an email and whatever the person chose to type, and none of that belongs to
-- any other visitor. The notifier reads it over the session pooler as postgres,
-- which is not subject to RLS.
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

--
-- The check is on `user_uuid`, not `true`. submit_feedback stamps it from
-- auth.uid(), but the grant below also permits a direct INSERT, and with
-- `WITH CHECK (true)` a signed-out client could simply post a row carrying
-- somebody else's uuid and have it read as "from a signed-in contributor".
-- Requiring it to match the caller makes the stamp true however the row
-- arrives: NULL for a stranger, their own id for a contributor, nothing else.
CREATE POLICY "Anyone may submit feedback."
ON public.feedback FOR INSERT
TO anon, authenticated
WITH CHECK (user_uuid IS NOT DISTINCT FROM (SELECT auth.uid()));

-- The grant ships in the same migration as the table (README convention): an
-- RLS policy with no grant behind it is a silent zero.
GRANT INSERT ON public.feedback TO anon, authenticated;

-- Trimming, and the identity stamp, in one place rather than at the call site.
--
-- SECURITY INVOKER (the default) — so this runs as anon or authenticated and is
-- still subject to the policy above, which is the point. Returns void rather
-- than the id: INSERT ... RETURNING needs a SELECT policy to hand a row back,
-- and there is deliberately no way for a client to read this table.
CREATE OR REPLACE FUNCTION public.submit_feedback(
  name TEXT,
  email TEXT,
  message TEXT,
  page_url TEXT,
  user_agent TEXT,
  release TEXT
) RETURNS void LANGUAGE SQL VOLATILE SET search_path=''
AS $$
  INSERT INTO public.feedback (name, email, message, page_url, user_agent, release, user_uuid)
  VALUES (
    TRIM(name),
    NULLIF(TRIM(email), ''),
    TRIM(message),
    NULLIF(TRIM(page_url), ''),
    NULLIF(TRIM(user_agent), ''),
    NULLIF(TRIM(release), ''),
    auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.submit_feedback(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
