# 081 — What iNaturalist takes down as spam, a copyright infringement or AI-generated, SalishSea.io takes down too

**Status:** accepted · **Decided:** 2026-10-20, by Peter · **Relates:** [075](075-an-inaturalist-observation-is-evidence-and-identifications.md) (an observation is its evidence and its identifications), [080](080-a-sighting-is-unconfirmed-until-someone-else-agrees.md) (unconfirmed sightings, which are shown, not hidden)

## Context

[iNaturalist observation 409281132](https://www.inaturalist.org/observations/409281132) reports a sea otter in Stanley Park, Vancouver, on 2026-10-18. A curator flagged its only photo as a copyright infringement the next day, and iNaturalist now serves a placeholder image of its own in place of the photo. The observation itself stays up there: it has no flag of its own, and it is not marked as spam. It is also marked captive, and its coordinates are the Vancouver Aquarium's.

We already left such photos out of a sighting, since #693, because our pages can't load iNaturalist's placeholder. But the sighting stayed on the map, a sea otter report with no photo and nothing to say why. Peter asked that what iNaturalist takes down come down here too, and that the copyright takedown in particular be read as a strong sign against the observation, more than its being captive.

Looking for other takedowns turned up a second kind. [Observation 194285803](https://www.inaturalist.org/observations/194285803), a humpback near Port Townsend in July 2023 from a tour operator's account, is flagged as spam, which hides it on iNaturalist. Its search still returns spam unless asked not to, and ours didn't ask, so the humpback was on our map with six photos.

Over the production mirror on 2026-10-20:

- **18 observations have a photo replaced for copyright infringement**, and none for AI-generated content. Seven of them are from Vancouver in October 2026, six of those by five different people on 2026-10-15, including two killer whale reports from Greater Vancouver that are not marked captive.
- **9 observations are flagged as spam**, all from the same tour operator: eight from July 2023 and one from 2012.

## Decision

**An iNaturalist observation that iNaturalist flags as spam is not fetched.** The fetch asks for `spam=false`. One flagged after we stored it leaves the mirror when its dates are next fetched as a reconciled window: within a run for the last ten days, and otherwise when the month comes round for anti-entropy, or at once by a manual backfill of its dates ([runbook](../runbook/read-path-build.md#backfilling-a-mirror)).

**An iNaturalist observation with any photo that iNaturalist replaced as a copyright infringement or as AI-generated content is left out of SalishSea.io entirely**: the map, the occurrence links and the profile pages. The Darwin Core archive already leaves out every iNaturalist record.

The reason is what the takedown says about the observation, not about the photo. A copied photo means the observer is showing someone else's evidence, and an AI-generated one means the evidence was made. Either way the report can't be taken as a firsthand sighting, whatever else the observation says. 075 treats an observation as its evidence plus its identifications; when the evidence is discredited, the identifications of it count for nothing.

The signal is the photo's URL, which iNaturalist points at `/assets/copyright-infringement-…` or `/assets/artificially-generated-content-…`, while the photo's `hidden` flag stays false. The mirror already stores that URL, so this rule is a condition in the occurrence derivation (`scripts/read-path/derive/occurrences.sql`), not a filter on the fetch: the observation leaves the site on the first build after the mirror sees the new URL, and if a curator resolves the flag and the photo comes back, the observation comes back with it.

## Not decided here

- **Captive observations.** iNaturalist marks an observation captive when its observer or the community votes that the animal isn't wild. In the Salish Sea box that's 183 observations, mostly from the Vancouver Aquarium. They are not wild sightings and probably don't belong on the map, but that is a separate rule with its own exceptions to think through, such as an animal in rehabilitation or a pen.
- **A photo hidden by iNaturalist's moderators for other reasons** (its `/assets/media-hidden-…` placeholder, for example for inappropriate content). That photo is left out, as before, but the observation stays, because hiding a photo for its content says nothing about whether the sighting happened.

## Rejected

- **Leaving the observation and only dropping the photo,** as before. The sighting then rests on the observer's word alone, and that observer has already shown someone else's evidence.
- **Waiting for iNaturalist to act on the observation.** It doesn't: the observation in the Context above has no flag of its own a day after its photo came down.
- **Storing the spam flag in the mirror and deciding in the derivation,** as the photo rule does. It would need a new column, filled in only as each observation is fetched again, so it would take as long to reach old observations as the reconciled windows do, for a flag that never needs to be shown or compared.
