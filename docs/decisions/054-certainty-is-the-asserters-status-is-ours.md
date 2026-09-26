# 054 — Certainty is the asserter's and status is ours; a hedge is carried to every consumer and resolved by none of them

**Status:** accepted · **Decided:** 2026-09-26 · **Answers:** the second half of `salish-8vr.4` (the first half is [053](053-a-bout-is-one-occurrence-per-species.md)) · **Extends:** [013](013-orcasound-acoustic-occurrences.md), [014](014-trust-and-curation-model.md), [053](053-a-bout-is-one-occurrence-per-species.md)

## Context

Decision [013](013-orcasound-acoustic-occurrences.md) twice declined to settle one thing, and [053](053-a-bout-is-one-occurrence-per-species.md) settled the other half of the same issue: how a moderator's certainty about a tag relates to our `identifications.status`. The register handed the question to us in animals [ADR-0018](https://github.com/salish-sea/animals/blob/main/decisions/0018-annotation-semantics-belong-to-consumers.md), with a warning that filing it "is this author's job wearing the other hat, which is precisely the kind of obligation that gets dropped." Its substance, carried over from the register's [Q18](https://github.com/salish-sea/animals/blob/main/docs/open-questions.md): keep the **asserter's confidence** apart from the **dataset's verification state**, because [ADR-0009](https://github.com/salish-sea/animals/blob/main/decisions/0009-uncertainty-on-the-annotation.md)'s sketch collapsed them, so "a moderator's `possible` that a curator later confirms has nowhere to land."

The split already exists in our schema and has never been exercised. `public.identifications` has carried `status` (`candidate` / `validated` / `rejected`) and a `confidence REAL` since migration `20260707220211`. On 2026-09-26 every row is `candidate`, every `confidence` is null, and nothing reads either: no view, no page and no DarwinCore term consults them. Upstream there is nothing to read yet. orcasite's `item_tags` has no certainty column ([orcasound/orcasite#1014](https://github.com/orcasound/orcasite/issues/1014) is open), and a moderator's hedge lives only in the bout's title. The example every thread uses is [`bout_031YvAeJ4O13YgkbQlc8yJ`](https://live.orcasound.net/bouts/bout_031YvAeJ4O13YgkbQlc8yJ), *SRKW signals at PT (J+K +L? pods)*: tagged `J`, `K`, `SRKW`, and not `L`, because applying `L` overstates what was heard and there was no third choice.

A bout's cited entities do not have identification rows at all today. `acoustic_bout_entities` holds the register identifier each tag cites, the occurrences view turns those into the register's labels (`J`, `T037s`), and `occurrence_identifier_candidates` matches the labels back to our groups and animals by the fold, exactly as it does for a Maplify comment. So a moderator's tag reaches `occurrence_identifications` as a `text_mention` captured by `text_extraction`, which it is not, after a round trip through a string that 013 refused for the tag itself. That row has no place for a hedge, and a label of `L?` would not fold.

One input arrived while this was open. Dave Bain, asked on [orcahello#650](https://github.com/orcasound/orcahello/pull/650#issuecomment-5839563408) about the cost of hedging, answered as a scientist rather than a UI designer: saying L pod was present when it wasn't is a lie, saying L pod might have been present is true either way, and the `?` is a flag that further review is merited if someone cares. What the flag *means* depends on who is reading. A manager protecting a new L pod calf may act as though L was present. A training set should ignore the record. A teacher sees a case study. He also described moderation as three stages spread over "minutes to years", the last of which is measurement work whose result is "to change L? to L".

## Decision

**Two axes, two columns, and neither is derived from the other.**

- **`certainty`** is what the asserter said: `certain`, `probable` or `possible`, the three values [#1014](https://github.com/orcasound/orcasite/issues/1014) proposes, and null when nobody asked. It is set by whoever made the claim and changed only by them. It arrives from a source as given, and from our own form when the form offers it.
- **`status`** is what the dataset says about the claim: `candidate`, `validated` or `rejected`, set by a curator on the site's behalf (decision [014](014-trust-and-curation-model.md)). A claim from any source arrives `candidate` whatever its certainty; an upstream `certain` is still a candidate here, as 053 already says. A curator's `validated` on a `possible` claim leaves it `possible`.

**A number is a machine's; a hedge is a person's.** `confidence REAL` stays, for a computer-vision score or a detector's class probability, and is never derived from a human hedge. `possible` does not become `0.5`. This resolves finding F7 in the [findings file](../design-notes/occurrence-identification-findings.md): two fields, and the conflict the register's sketch saw was between a column and the wrong use of it.

**Verification never rewrites certainty. A resolved hedge is a new claim.** Dave Bain's third stage, `L?` becoming `L`, is the asserter's own revision, and reaches us as one when orcasite records it ([#1051](https://github.com/orcasound/orcasite/issues/1051)'s `tag_certainty_revised`). If a curator here concludes that L pod was present, that is the curator's claim: its own row, asserted by them, `certain`, `validated`, beside the moderator's row, which stands as written. A reader sees both and who said which. This is what "one row per claim", the design rule of `public.identifications`, means when two people disagree about how sure to be.

**A hedge is carried to every consumer and resolved by none of them on the reader's behalf.** Each consumer gets the flag and makes its own reading, which is the only rule that serves the manager, the trainer and the teacher at once.

- **The map** shows a `possible` identifier with the mark the moderators already use, a trailing `?`: `Killer whale · J pod, K pod, L pod?`. It is never dropped and never shown plain. `probable` and `certain` show plain; the map has two display states where the data has three, because "probably J" is J to someone deciding whether to listen, and the third value is kept for the readers who distinguish.
- **Profile pages** list an occurrence a `possible` claim reaches, marked the same way. A `rejected` claim does not reach a page.
- **The DarwinCore archive**, when bouts enter it (013, 2026-09-20 amendment), carries a hedge as a qualifier and never as an exclusion. A hedge on the occurrence's species is `identificationQualifier`: `?` for `possible`, `cf.` for `probable`. A hedge on a group or animal below the species stays inside `unvalidatedIdentifiers` with its `?`, where such identifiers already live ([rights-policy §2.4](../rights-policy.md)). Excluding a hedged record decides for every consumer that the hedge means "no", which is the one reading nobody asked for.

**Where it lives.** `public.identifications` gains `certainty`, a nullable enum, and the `confidence` column gains a check that ties it to a machine method. A bout's cited entity becomes an identification row written by the ingest, `method = upstream_import`, with a new evidence value for sound, keyed on the register identifier the tag cites, one row per tag application, carrying the application's certainty and, once `item_tags` are on the API, its applier. It stops being re-extracted from its own label. A bout whose species is reached only through `possible` entities is itself a hedged occurrence; the archive term for that is fixed above, and how the occurrences view exposes it is the implementing issue's to choose.

**A bout naming no animal** stays as 053 decided: held, not shown. The one thing that would change that is a moderator's mark that review is complete, which is orcasite's ([#1051](https://github.com/orcasound/orcasite/issues/1051) names it and does not build it). Until then 053 stays provisional on that point, and on that point only.

## The example, worked

Once [#1014](https://github.com/orcasound/orcasite/issues/1014) lands and a moderator adds `L` to `bout_031YvAeJ4O13YgkbQlc8yJ` as `possible`, the bout's animal tags cite `SSA:0000010`, `SSA:0000020`, `SSA:0000021` and `SSA:0000022`, all under *Orcinus orca*. That is one occurrence, `orcasound:bout_031YvAeJ4O13YgkbQlc8yJ:SSA:0000900`, and four identification rows:

| subject | certainty | status | asserted by |
|---|---|---|---|
| Southern Resident (community) | `certain` | `candidate` | the moderator |
| J pod | `certain` | `candidate` | the moderator |
| K pod | `certain` | `candidate` | the moderator |
| L pod | `possible` | `candidate` | the moderator |

The map label reads `Killer whale · J pod, K pod, L pod?, Southern Resident`, the identifiers being the register's labels for the cited groups (053). If a curator later validates J and K, two rows become `validated` and nothing else changes. If a curator concludes L was there, a fifth row appears, `certain`, `validated`, asserted by the curator; the moderator's `L?` stays. If the moderator does the measurement work and revises their own tag, the fourth row's certainty changes and no new row appears. Today, with no certainty column upstream, the fourth row does not exist, and the first three arrive with certainty null.

## Rejected alternatives

- **One axis.** Let `possible` be a status beside `candidate` and `validated`, as [ADR-0009](https://github.com/salish-sea/animals/blob/main/decisions/0009-uncertainty-on-the-annotation.md)'s sketch did. Then a moderator's `possible` that a curator confirms has to become something, and whatever it becomes erases either the hedge or the confirmation. Q18's entire substance is that these are different questions asked of different people.
- **Certainty as a number.** Map `certain` / `probable` / `possible` onto `confidence` as `1.0` / `0.75` / `0.5`. A listening moderator has no probability, and a number invites arithmetic nobody asserted. [#1014](https://github.com/orcasound/orcasite/issues/1014) refuses this upstream for the same reason; it would be strange to undo that on arrival.
- **Derive status from certainty.** Let an upstream `certain` arrive `validated`. Verification is ours (014); a source's confidence in its own claim is not our verification of it, and every source would then validate itself.
- **Promote on validation.** Let a curator's `validated` rewrite `possible` to `certain`. It destroys the moderator's claim, and the audit that Dave Bain's third stage depends on, to save one row.
- **Drop `possible` from the map or the archive.** The conservative-looking choice, and the one that reads the hedge as "no" for everyone. The manager who needed it most is the one it fails.
- **Hold the hedge in the label string.** Write `L?` into `acoustic_bout_entities` or the identifiers array and let consumers parse it. That is the moderator's title again, one field over, and it does not fold.

## Consequences

- **A migration**: the `identification_certainty` enum and the column; the check on `confidence`; an evidence value for sound; the ingest writing identification rows for bout entities in place of the label round trip; the `?` on the map label; the archive terms, dormant until bouts enter the archive. Tracked as `salish-8vr.27`. The column and the row refactor need no upstream change and can go first; the certainty values wait on orcasite exposing `item_tags` with certainty on the bouts include ([#1014](https://github.com/orcasound/orcasite/issues/1014), [#1051](https://github.com/orcasound/orcasite/issues/1051)), tracked as `salish-8vr.8`.
- **Reviewed-and-empty** (finding F6) remains the one open thing about a bout with no animal, and it is upstream: tracked as `salish-8vr.28`, blocked on orcasite recording that a moderator finished.
- **Our own sighting form** has no hedge today. When it gets one, it is this column with these values, and the `?` on the map is the same `?`.
- **`salish-8vr.5`**, a validated identification whose entity later splits, is the same principle from another side: the moderator was right at the time, and verification does not rewrite what they said. That record still needs a state the enum lacks, and this decision does not supply it.
- **Decision 053** is answered on certainty and stays provisional only on the review mark; **decision 013**'s two "does not decide" sections now point here.

## Reference

Register side: [ADR-0018](https://github.com/salish-sea/animals/blob/main/decisions/0018-annotation-semantics-belong-to-consumers.md) (the hand-off), [ADR-0009](https://github.com/salish-sea/animals/blob/main/decisions/0009-uncertainty-on-the-annotation.md) (the hedge ban and the sketch it keeps only as illustration), [Q18](https://github.com/salish-sea/animals/blob/main/docs/open-questions.md). Orcasound side: [orcasound/orcasite#1014](https://github.com/orcasound/orcasite/issues/1014) (certainty on the application), [#1051](https://github.com/orcasound/orcasite/issues/1051) (events, `item_tags` on the API, the review-complete mark), Dave Bain on [orcahello#650](https://github.com/orcasound/orcahello/pull/650#issuecomment-5839563408). Ours: [013](013-orcasound-acoustic-occurrences.md), [014](014-trust-and-curation-model.md), [053](053-a-bout-is-one-occurrence-per-species.md), the [findings file](../design-notes/occurrence-identification-findings.md) (F2, F5, F6, F7), [rights-policy §2.4](../rights-policy.md). Schema: `supabase/migrations/20260707220211_identifications.sql`, `supabase/migrations/20260920210000_acoustic_bouts.sql`.
