-- Our own matriline membership rows are dropped (decision 050, salish-ox2.5).
--
-- Nothing has read public.group_memberships since migration 20260923010000 moved
-- membership to the register: public.matriline_members projects register.ancestor, and
-- individual_occurrences and ecotype_occurrences read that. Per decision 051, a copy of
-- something the register holds goes once nothing reads it. membership_basis typed only
-- this table's `basis` column.

DROP TABLE public.group_memberships;
DROP TYPE public.membership_basis;
