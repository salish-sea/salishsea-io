# 122 — Orcasound detections are occurrences, which people confirm or reject

**Status:** accepted; amended the same day (see [Amendment](#amendment-2026-11-25): a detection's taxon is what its detector claims, and an OrcaHello moderator's no rejects only a Southern Resident) · **Decided:** 2026-11-25, by Peter · **Work:** bd `salish-fizm` · **Amends:** [013](013-orcasound-acoustic-occurrences.md) (Orcasound occurrences came from bouts alone) · **Relates:** [080](080-a-sighting-is-unconfirmed-until-someone-else-agrees.md) (a sighting's `confirmation`), [053](053-a-bout-is-one-occurrence-per-species.md) (a bout is one occurrence per species), [054](054-certainty-is-the-asserters-status-is-ours.md) (claims and their status), [120](120-curators-review-a-days-reports-from-every-source-and-facebook-points-wait-for-them.md) (curators review a day's reports)

## Context

Decision 013 took Orcasound's bouts as occurrences: a span of time at a hydrophone that a moderator drew, with tags saying what was heard. Bouts are few (187 whale bouts from November 2025, when moderators began drawing them routinely, to November 2026) and they come late, after a moderator has listened. orcasite also publishes every detection, at `/api/json/detections` with no sign-in. A detection is the moment a listener pressed the button, or the moment OrcaHello's model heard a call, at one hydrophone, marked as a whale, a vessel or something else. There were 21,139 from January to November 2026, 17,463 of them OrcaHello's. OrcaHello's own API adds, for each of its detections, the model's confidence, a label for each 3-second window, and its moderators' answer: yes, no or don't know.

A detection arrives in minutes. But many are wrong. Of the 13,110 OrcaHello detections from September 2020 to November 2026 that a moderator answered yes or no, 22% were answered yes. A review of the data on 2026-11-24 and 25 is in bd `salish-fizm`.

## Decision

**A detection marked as a whale becomes an occurrence of its own, beside the bouts.** Detections of a vessel or of something else don't.

**Its taxon is what its detector claims, until a person says otherwise.** A listener's detection claims a whale, so its taxon is Cetacea. OrcaHello's Southern Resident detector (the FastAI model and its successor, `orcasound/orcahello-srkw-detector-v1`) is trained to hear Southern Resident calls and nothing else, so its detection claims a Southern Resident. PODS-AI (`davethaler/whale-call-detector`) labels each 3-second window resident, transient or humpback, among other sounds; its detection claims its label's taxon: Bigg's for transient, a humpback for humpback, and a killer whale for resident until we know whether its "resident" means Southern Residents only. A person's word replaces the detector's: an OrcaHello moderator's answer and tags (below), or the species of the confirmed bout the detection falls in. What the animals were, beyond the taxon, comes from that bout or from a segment of sightings, which is our most precise source; how a detection joins a segment is for bd `salish-fizm.4` and `salish-2rki`. orcasite's category says only "whale" because OrcaHello's posting code writes that for every machine detection; asking the models to send their label with the detection (bd `salish-8vr.11`) would carry the claim through orcasite too.

> ~~**Its taxon is what it says: a whale, a cetacean.** It is not assumed to be a Southern Resident, though most are.~~ *Amended 2026-11-25: OrcaHello's models claim more than orcasite's "whale" says. See the [Amendment](#amendment-2026-11-25).*

**Whether it is confirmed is settled by the first of these that applies:**

1. **A curator's answer** in the review view of decision 120, once that is built: confirmed, or rejected.
2. **An OrcaHello moderator's answer**, for OrcaHello's own detections. The moderator is asked "Was there an SRKW call in this clip?", so the answer is about Southern Residents. Yes confirms the detection as a Southern Resident. No rejects only that: if the moderator's tags name another whale (humpback, transient, orca or whale), the detection is confirmed as that whale, since a moderator listened and named it; otherwise no rejects the detection. "Don't know" settles nothing. A listener's detection has no such answer.
3. **A confirmed bout:** the detection falls within the span of a bout at its hydrophone whose occurrence for a cetacean is confirmed (080, 053). A bout of a species tagged only as possible is unconfirmed, and so confirms nothing.
4. **Otherwise it is unconfirmed**, and shown as unconfirmed sightings are (080).

So an OrcaHello moderator's no stands even when the detection falls in a bout; the bout is still on the map. A curator can overrule an OrcaHello moderator.

**A rejected detection is withheld.** A rejected detection is one a curator rejected, or one an OrcaHello moderator answered no without naming another whale. It is kept as data, since a moderator's or curator's answer is a claim and claims are mirrored as stated (054), but it is not shown on the map and not published. This is not an exception to 080's rule that an unconfirmed sighting is shown: a rejected detection is not one that nobody has agreed with yet, but one that someone has judged wrong. The published `confirmation` keeps its three values; a rejected detection simply isn't among what is published.

**An unconfirmed detection doesn't lead to a notice to ships.** Only a confirmed one does. When a reliability score exists (bd `salish-fizm.2`), a high enough score may stand in for a person's confirmation; that will be a decision of its own.

## Undecided

- How a detection is drawn beside its bout and its segment (bd `salish-fizm.4`).
- Whether detections go into the Darwin Core archive. Bouts don't yet (013).

## Rejected

- **Take only bouts, as 013 did.** A bout comes after a moderator has listened, often hours later.
- **Show a rejected detection, marked disputed.** `disputed` is for disagreement that hasn't been settled (080). A moderator's or curator's no settles it, and showing about three and a half rejected detections for every confirmed one would hide the real ones.
- **Make an OrcaHello moderator's yes wait for a bout or a curator.** OrcaHello's moderators are the people best placed to judge its detections, and their yes is a judgment already made.
- **Take every detection to be a Southern Resident.** Most are, but a listener's detections that fall in a bout are Bigg's or humpbacks about 15% of the time, and a mark on the map asserts its taxon (053). A detection claims what its detector can claim, no more.
- **Take an OrcaHello moderator's no to mean no whale.** Moderators are asked about Southern Resident calls only. Of the 10,214 detections answered no, they tagged 397 humpback, 186 transient, 195 orca and 533 whale.

## Consequences

- The build needs OrcaHello's answers, not only orcasite's detections. orcasite keeps a machine detection's time and description, but not its confidence, its labels or the moderator's answer. OrcaHello's API must be read a month at a time (`Timeframe=range`), because `Timeframe=all` reads its whole database for every page (bd `salish-fizm.1`).
- Many detections on the map will be unconfirmed: about half of OrcaHello's have never been answered, and a listener's are confirmed only by a bout or a curator. How they look matters (bd `salish-fizm.4`).
- The curator role of 014 and 120, not yet built, comes first in deciding a detection's confirmation. Decision 120 speaks of curators approving and withholding; how that relates to confirming and rejecting is still open there.

## Amendment (2026-11-25)

The record first said a detection's taxon is a cetacean and that an OrcaHello moderator's no rejects the detection. Both took orcasite's category, "whale", at its word. OrcaHello's models say more: its main model is trained only on Southern Resident calls (`InferenceSystem/model/MODEL_CARD.md` in orcasound/orcahello), and PODS-AI labels killer whale ecotypes and humpbacks. And its moderators are asked a narrower question than whether a whale was there: "Was there an SRKW call in this clip?" (`DetectionMinuteComponent.razor`). So a yes confirms a Southern Resident, and a no rejects only a Southern Resident; the moderator's tags say whether some other whale was heard. Of the OrcaHello detections answered yes, those tagged with a species were Southern Residents in 99% of cases for the Southern Resident detector (893 of 900) and in 98% for PODS-AI's resident label (425 of 432).

Two things decided with the amendment, for the first version of the ingest (bd `salish-fizm.1`): a listener's free-text description on orcasite is not shown, because it is rarely useful and listeners don't expect it to appear elsewhere; and a detection falls in a bout only within the bout's span, with no slack before or after, so the rule stays simple and practice can adjust it.
