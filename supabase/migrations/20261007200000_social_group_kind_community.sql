-- A social group can be a community (decision 070, salish-lzi.3): the Southern Residents'
-- top page is their community's, which the register ranks between the Resident ecotype
-- and the pods. The read-path build's catalogue generates that row from the register and
-- holds it to this vocabulary (data/reference/enums.tsv, which CI keeps equal to a fresh
-- migration replay). Placed after ecotype, as the rank sits beneath it.
ALTER TYPE public.social_group_kind ADD VALUE IF NOT EXISTS 'community' AFTER 'ecotype';
