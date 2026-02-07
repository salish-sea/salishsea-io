ALTER TABLE public.user_contributor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Look up self" ON public.user_contributor FOR SELECT
USING (
  (select auth.uid()) = user_uuid
);

ALTER TABLE public.contributors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View all contributors" ON public.contributors FOR SELECT USING (TRUE);
