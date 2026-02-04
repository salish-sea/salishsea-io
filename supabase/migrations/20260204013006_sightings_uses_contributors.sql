ALTER TABLE public.observations ADD COLUMN contributor_id INTEGER REFERENCES contributors (id) ON DELETE CASCADE;
UPDATE observations
  SET contributor_id = uc.contributor_id
  FROM user_contributor AS uc
  WHERE observations.user_id = uc.user_uuid;
ALTER TABLE public.observations ALTER COLUMN contributor_id SET NOT NULL;
ALTER TABLE public.observations DROP COLUMN user_id;