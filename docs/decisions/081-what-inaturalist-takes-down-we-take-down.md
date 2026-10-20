# 081 — What iNaturalist takes down, or its community votes wrong, SalishSea.io takes down too

**Status:** accepted · **Decided:** 2026-10-20, by Peter · **Relates:** [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) (an observation is its evidence and its identifications), [080](080-a-sighting-is-unconfirmed-until-someone-else-agrees.md) (unconfirmed sightings, which are shown, not hidden)

## Context

[iNaturalist observation 409281132](https://www.inaturalist.org/observations/409281132) reports a sea otter in Stanley Park, Vancouver, on 2026-10-18. A curator flagged its only photo as a copyright infringement the next day, and iNaturalist now serves a placeholder image of its own in place of the photo. The observation itself stays up there: it has no flag of its own, and it is not marked as spam. It is also marked captive, and its coordinates are the Vancouver Aquarium's.

We already left such photos out of a sighting, since #693, because our pages can't load iNaturalist's placeholder. But the sighting stayed on the map, a sea otter report with no photo and nothing to say why. Peter asked that what iNaturalist takes down come down here too, and that the copyright takedown in particular be read as a strong sign against the observation, more than its being captive.

Looking for other takedowns turned up a second kind. [Observation 194285803](https://www.inaturalist.org/observations/194285803), a humpback near Port Townsend in July 2023 from a tour operator's account, is flagged as spam, which hides it on iNaturalist. Its search still returns spam unless asked not to, and ours didn't ask, so the humpback was on our map with six photos.

Over the production mirror on 2026-10-20:

- **18 observations have a photo replaced for copyright infringement**, and none for AI-generated content. Seven of them are from Vancouver in October 2026, six of those by five different people on 2026-10-15, including two killer whale reports from Greater Vancouver that are not marked captive.
- **9 observations are flagged as spam**, all from the same tour operator: eight from July 2023 and one from 2012.

Peter then asked whether we should show anything iNaturalist grades Casual. Of the 1,158 Casual observations in the Salish Sea box on 2026-10-20, the grade means quite different things:

| Why iNaturalist grades it Casual | Observations |
|---|---|
| No photo or sound | 834 |
| Its community voted that the animal isn't wild (iNaturalist calls these captive) | 183 |
| Its community voted that the location, date or evidence is wrong, or not of one subject, or not recent | 69 |
| No date (already out, [043](043-undated-observations-are-out-of-scope.md)) | 68 |
| Other | 6 |

The 834 with no photo or sound are mostly birders logging marine mammals as they go ("2 on red buoy structure", "One swimming north about 20 to 30 feet from the shoreline"), 38 of them killer whales. Each is an observer's word without a picture, which is what most Maplify reports are.

## Decision

**An iNaturalist observation that iNaturalist flags as spam is not fetched.** The fetch asks for `spam=false`. One flagged after we stored it leaves the mirror when its dates are next fetched as a reconciled window: within a run for the last ten days, and otherwise when the month comes round for anti-entropy, or at once by a manual backfill of its dates ([runbook](../runbook/read-path-build.md#backfilling-a-mirror)).

**An iNaturalist observation with any photo that iNaturalist replaced as a copyright infringement or as AI-generated content is left out of SalishSea.io entirely**: the map, the occurrence links and the profile pages. The Darwin Core archive already leaves out every iNaturalist record.

The reason is what the takedown says about the observation, not about the photo. A copied photo means the observer is showing someone else's evidence, and an AI-generated one means the evidence was made. Either way the report can't be taken as a firsthand sighting, whatever else the observation says. 075 treats an observation as its evidence plus its identifications; when the evidence is discredited, the identifications of it count for nothing.

**An iNaturalist observation that its community voted wrong is left out too.** iNaturalist asks voters a set of data-quality questions: is the organism wild, do the location and date seem accurate, is there evidence of the organism, is the evidence recent and of a single subject, does it depict the organism accurately. A question fails when fewer than half the votes on it agree, a tie passing, which is iNaturalist's own rule ([`Observation#passes_quality_metric?`](https://github.com/inaturalist/inaturalist/blob/0e15a4a4bd64b914672be1e4e6492c272a79fa9a/app/models/observation.rb#L1504-L1507)). An observation with any failing question is left out. The "wild" question is how iNaturalist marks an observation captive: the 183 captive observations are exactly the ones whose "wild" question fails. A sea otter at the aquarium is not a wild sighting, and a vote that the place or day is wrong is people who looked saying the sighting is mistaken.

**What stays: the observations Casual only because they have no photo or sound.** They are shown as unconfirmed under [080](080-a-sighting-is-unconfirmed-until-someone-else-agrees.md), as an unchecked Maplify report is. Hiding them would adopt iNaturalist's grade as our verdict, which [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) rejected, and would hide reports nobody has said are wrong.

The mirror keeps every vote on an observation, as JSON in a column of `observations`, and the derivation applies the rule, so an observation that comes back to passing comes back here. A mirror from before this decision holds no votes, so an observation's votes arrive when it is next fetched in a reconciled window, or at once by a manual backfill of its dates.

The signal for a photo takedown is the photo's URL, which iNaturalist points at `/assets/copyright-infringement-…` or `/assets/artificially-generated-content-…`, while the photo's `hidden` flag stays false. The mirror already stores that URL, so this rule is a condition in the occurrence derivation (`scripts/read-path/derive/occurrences.sql`), not a filter on the fetch: the observation leaves the site on the first build after the mirror sees the new URL, and if a curator resolves the flag and the photo comes back, the observation comes back with it.

## Not decided here

- **A photo hidden by iNaturalist's moderators for other reasons** (its `/assets/media-hidden-…` placeholder, for example for inappropriate content). That photo is left out, as before, but the observation stays, because hiding a photo for its content says nothing about whether the sighting happened.

## Rejected

- **Leaving the observation and only dropping the photo,** as before. The sighting then rests on the observer's word alone, and that observer has already shown someone else's evidence.
- **Waiting for iNaturalist to act on the observation.** It doesn't: the observation in the Context above has no flag of its own a day after its photo came down.
- **Hiding everything iNaturalist grades Casual.** That would hide 834 reports nobody has said are wrong, for lacking a photo, while Maplify's reports without one are shown; and it would make iNaturalist's grade our verdict, which 075 rejected.
- **Asking iNaturalist for `captive=false`,** as the spam rule does. It would cover captive observations only, not the other votes, and the votes have to be in the mirror for those anyway.
- **Storing the spam flag in the mirror and deciding in the derivation,** as the photo rule does. It would need a new column, filled in only as each observation is fetched again, so it would take as long to reach old observations as the reconciled windows do, for a flag that never needs to be shown or compared.
