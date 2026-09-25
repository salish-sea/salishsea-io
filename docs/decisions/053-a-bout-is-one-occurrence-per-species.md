# 053 — A bout is one occurrence per species its tags reach; a bout naming none is held, not shown

**Status:** provisional · **Decided:** 2026-09-25 · **Answers:** `salish-8vr.4`, for now · **Extends:** [013](013-orcasound-acoustic-occurrences.md)

## Context

Decision [013](013-orcasound-acoustic-occurrences.md) makes an acoustic occurrence one curated `biophony` bout, identified by the register entities its tags cite. It left two things open, tracked as `salish-8vr.4`: what a bout with no animal tag does, and how a moderator's certainty relates to our verification status. The ingest (`salish-8vr.26`) cannot ship without an answer to the first, and Peter decided on 2026-09-25 that provisional data on the map is acceptable while the upstream design settles ([orcasound/orcasite#1051](https://github.com/orcasound/orcasite/issues/1051)), provided bouts stay out of the DarwinCore archive.

Two facts of the data force the shape. An occurrence has exactly one taxon, because `public.occurrences.taxon` is one `public.taxon` and `src/segments.ts` chains occurrences by `species_id`. A bout may cite entities under more than one species: a moderator who hears Southern Residents and a humpback in the same half hour tags both, and that is two animals' worth of sound, not one ambiguous record. And a bout may cite nothing — 63 of 155 live biophony bouts carried no animal tag on 2026-09-20, and on 2026-09-25 no tag carried an identifier at all, since the classification ([orcasound/orcasite#1016](https://github.com/orcasound/orcasite/issues/1016)) waits on a moderator.

## Decision

**A bout becomes one occurrence per species its cited entities reach.** Each entity is walked to its species with `register.taxon_entity_for` (decision [033](033-register-names-the-animals.md)'s ancestry, migration `20260921010000`), the cited entities are grouped by that species, and each group is one occurrence with id `orcasound:<bout>:<species entity>`. Its taxon is the species, named as the register names it; its identifiers are the register's labels for the cited groups and individuals under that species (`J`, `T037s`), never the species itself, so the map can say "Killer whale" and "J" the way decision [029](029-map-symbology.md) wants.

**A bout that cites no entity the register can place is held in `public.acoustic_bouts` and shown nowhere.** That covers a bout with no animal tag and a bout whose only entity is a split deprecation. It is not deleted, not flagged, and not shown as an unnamed animal: a record on the map asserts a taxon, and there is none to assert. The register's warning in animals ADR-0018 stands — the absence of tags is not the absence of animals — and holding the row is what keeps that true when the tag arrives.

**Every tag is tentative.** An identifier from a source system arrives as a candidate, never validated (decision [004](004-rights-and-licensing.md)); nothing here changes that. Certainty, once orcasite records it ([orcasound/orcasite#1014](https://github.com/orcasound/orcasite/issues/1014)), is a property of the tag application and will arrive through `item_tags`, which the ingest does not read yet.

**Bouts stay out of the DarwinCore export**, as 013's 2026-09-20 amendment already decided. The `dwc.*` views read their source tables directly, so the new branch of `public.occurrences` cannot leak into the archive.

## Why provisional

The shape above is right for the data as it is. Two things could change it, and both are upstream:

- **orcasite#1051** proposes that a bout's changes be recorded as events and that `item_tags` become visible on the API with a per-tag certainty. When that lands, the ingest reads `item_tags`, and a `possible` tag may want to reach the map differently from a `certain` one. That is the second half of `salish-8vr.4`, still open.
- **A moderator mark that a bout's tagging is finished** would let "reviewed and empty" be distinguished from "not tagged yet". Today neither is shown, which is the conservative choice; with the mark, a reviewed-empty biophony bout could reasonably appear as acoustic activity with no animal named.

Until then, this record is what the branch does, and `salish-8vr.4` stays open for the rest.

## Rejected alternatives

- **One occurrence per bout, taxon chosen by rule** (the first entity, the most specific, the most-cited). Every rule discards a claim the moderator made, and the map would show a humpback bout as orcas or the reverse depending on tag order.
- **One occurrence per bout with a null taxon when it names none.** `taxon` is nullable on other branches only by accident of LEFT JOINs; nothing downstream renders a null taxon, and an unnamed marker at a hydrophone reads as "an animal was here" when the record says less than that.
- **Match tag names against the register when `iri` is null.** Withdrawn in 013's 2026-09-20 amendment: the gap is closed in orcasite, once, for every consumer.

## Consequences

- Until #1016 is applied on production, the ingest fills `acoustic_bouts` (156 biophony bouts on 2026-09-25) and the map shows none of them. The day the 16 animal tags gain identifiers, the next tick adds the entities and the bouts appear, with no deploy here.
- An occurrence id carries two colons. Nothing in `src/` splits an occurrence id on `:`; the prefix rule in CONTEXT.md ("`{source}:{id}`") still holds with `{id}` = `<bout>:<species>`.
- `ingest.runs` records a window for the `orcasound` source that bounds nothing; the source reconciles the whole corpus. The heartbeat treats it like any other source.

## Reference

Ingest: [scripts/ingest/orcasound.ts](../../scripts/ingest/orcasound.ts), [supabase/functions/ingest/fetch-orcasound.ts](../../supabase/functions/ingest/fetch-orcasound.ts), `persistOrcasound` in [scripts/ingest/persist.ts](../../scripts/ingest/persist.ts). Migration: `supabase/migrations/20260925120000_orcasound_ingest.sql`. Tests: `scripts/ingest/orcasound.test.ts`, `supabase/acoustic-occurrences.test.ts`. Tracking: `salish-8vr.26`, `salish-8vr.4`.
