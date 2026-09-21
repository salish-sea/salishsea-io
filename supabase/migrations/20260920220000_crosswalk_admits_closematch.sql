-- Admit coextensive closeMatch to the crosswalk (salish-0gb.3).
--
-- RESTATING THE RULE, NOT RELAXING IT. Migration 20260828100000 filtered
-- `predicate_id = 'skos:exactMatch'`, and the reason it recorded was that a broader match
-- "would put a wider claim on the map than the data supports". It stayed an allow-list of
-- ONE not because one was the right size but because exactMatch was the only predicate the
-- register then had that could be honoured. The criterion the reason describes — does this
-- predicate assert the same extension, or change it? — admits more than one member.
--
-- Between coextensive concepts the reason does not apply. Edition 2026.09.2 crosswalks the
-- two killer whale ecotypes to iNaturalist's two subspecies as `skos:closeMatch` — close
-- rather than exact because the register calls one an ecotype and iNaturalist calls the
-- other a subspecies, so they are different KINDS of thing with the same EXTENSION. The
-- equation is not ours. The Society for Marine Mammalogy's List of Marine Mammal Species
-- and Subspecies (April 2026), declining species rank for now, says "the two ecotypes are
-- considered here provisionally as distinct subspecies of Orcinus orca". An authority
-- equating the two concepts is the entire licence for this change; without it the row
-- would be a second opinion and decision 033 would forbid it.
--
-- So the filter below stays an ALLOW-LIST, and gains a second member. This matters more
-- than the word: an allow-list refuses what it does not name, so `skos:broadMatch`,
-- `skos:narrowMatch`, `skos:relatedMatch` and every predicate the register invents after
-- this migration are all refused by the same mechanism, without being enumerated.
--
-- Do NOT rewrite it as `predicate_id NOT IN ('skos:broadMatch', ...)`. That reads like the
-- same rule and is not: it admits narrowMatch and relatedMatch today, and silently admits
-- whatever the register adds tomorrow. Why each would be wrong — broadMatch is how the
-- register says an ecotype sits inside its species, so resolving through one would put
-- "Killer whale" on a record that said Southern Resident; narrowMatch does the reverse;
-- relatedMatch asserts no extensional relation at all; and an unrecognised predicate is
-- simply not evidence of sameness. A predicate the register invents later must be
-- adjudicated here before it can reach the map, and failing closed is how
-- that adjudication gets forced.
--
-- WHAT THIS ADMITS THAT IS NOT COEXTENSIVE, deliberately. SSA:0000938 Pinnipedia is
-- closeMatch to iNaturalist's 372843, which strictly names Phocoidea — the true-seal
-- superfamily — and is therefore NARROWER than the register's entity. It is admitted
-- anyway because iNaturalist's taxon is a misnomer in practice: it is labelled "Pinnipeds"
-- and returns Otariidae beneath it, so an observer choosing it means "a seal or a sea
-- lion", which is Pinnipedia exactly. The register's own entity note says so and decision
-- 027 records the same misnomer from our side. 189 occurrences; the visible effect is that
-- the label loses a plural, "Pinnipeds" -> "Pinniped". Recorded here rather than excluded
-- by name in SQL, because an exclusion keyed on an identifier would be our second opinion
-- about a register row and would go stale in silence if the register ever fixed it.
--
-- MIGRATION 20260828120000'S ORCINUS EXEMPTION IS NOW INERT, AND ITS COMMENT IS STALE.
-- That migration rolls a subspecies up to its species' register name and exempts the two
-- killer whales, because their qualifier is the ecotype the map most wants. It predicted
-- its own obsolescence in as many words: "salish-0gb asks whether the register should
-- carry entities for those two subspecies; the moment it does, the exact-id match wins and
-- this clause stops applying to them on its own."
--
-- That has now happened. The roll-up is the `par` join — the register name of the taxon's
-- PARENT — and `public.occurrences` reads COALESCE(reg.common_name, par.common_name, ...),
-- so once `reg` resolves a subspecies at its own iNaturalist id the `par` branch is never
-- consulted for it. The exemption is left in place rather than removed: it still governs
-- Delphinus, and it still governs any Orcinus subspecies iNaturalist adds that the register
-- has not crosswalked, which is the behaviour we would want in that case anyway. Nothing
-- reads it for ater or rectipinnus any more.
--
-- THE DISTINCT ON BELOW IS STILL DETERMINISTIC. Admitting a second predicate widens the
-- space in which two entities could claim one iNaturalist taxon, and a duplicate here
-- would silently DOUBLE every occurrence of that animal on the map. That hazard is closed
-- upstream rather than here: animals `bin/validate.py` checks uniqueness across
-- exactMatch and closeMatch together, and edition 2026.09.2 has no taxon claimed twice.
-- The tie-break is unchanged and remains a fallback, not an editorial choice.
CREATE OR REPLACE VIEW register.inaturalist_taxon_name AS
SELECT DISTINCT ON (split_part(m.object_id, ':', 2)::integer)
  split_part(m.object_id, ':', 2)::integer AS inat_taxon_id,
  e.entity_id,
  e.label   AS entity_label,
  n.name    AS common_name
FROM register.mappings m
JOIN register.entities e ON e.entity_id = m.subject_id
JOIN register.names    n ON n.entity_id = e.entity_id AND n.type = 'common'
-- An ALLOW-LIST, and it has to stay one: an unlisted predicate is refused, so the default
-- for anything the register adds later is to stay off the map until adjudicated. See the
-- header for why `NOT IN (...the widening ones)` is not the same rule.
WHERE m.predicate_id IN ('skos:exactMatch', 'skos:closeMatch')
  -- The WHOLE identifier is matched, not a prefix plus one field. A prefix test with
  -- split_part accepts 'inaturalist.taxon:41777:legacy' — split_part returns 41777 and
  -- the trailing segment is never examined — so a malformed mapping would silently
  -- crosswalk as if it were the canonical one.
  --
  -- Length-bounded too: an unbounded digit string is still numeric and would overflow the
  -- ::integer cast at query time, breaking every read of public.occurrences rather than
  -- skipping one bad row.
  AND m.object_id ~ '^inaturalist\.taxon:[0-9]{1,9}$'
ORDER BY split_part(m.object_id, ':', 2)::integer,
         -- exactMatch outranks closeMatch, so that if an entity ever holds both to one
         -- taxon the stronger assertion is the one displayed. Nothing in edition 2026.09.2
         -- does; this keeps the outcome stated rather than incidental.
         (m.predicate_id = 'skos:exactMatch') DESC,
         (n.language = 'en') DESC NULLS LAST,
         length(n.name),
         n.name;

COMMENT ON VIEW register.inaturalist_taxon_name IS
  'iNaturalist taxon id -> the register''s common name for that animal. Exact and close '
  'matches only; widening predicates (broadMatch, narrowMatch, relatedMatch) and any '
  'unrecognised predicate are refused. See the view definition for why.';
