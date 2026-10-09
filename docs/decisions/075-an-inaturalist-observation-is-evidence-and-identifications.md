# 075 — An iNaturalist observation is evidence and identifications, and the confidence is ours

**Status:** accepted (direction) · **Decided:** 2026-10-09 (Peter's call) · **Answers:** bd `salish-nfsg` · **Extends:** [014](014-trust-and-curation-model.md), [054](054-certainty-is-the-asserters-status-is-ours.md)

## Context

With certainty modelled ([054](054-certainty-is-the-asserters-status-is-ours.md)), the obvious next input was iNaturalist's quality grade: Research Grade looks like a sign of confidence, Needs ID like its absence. It fits neither of 054's axes. Certainty is the asserter's own hedge, and status is our curators' judgment of a claim. A quality grade is neither: it is iNaturalist's verdict, computed from its community taxon (the taxon enough of an observation's identifiers agree on) and a list of data-quality rules. It is a derived value, and the rules that derive it are iNaturalist's.

Today the build's iNaturalist arm takes the observation's current taxon and nothing about who identified it or how many agreed, and its certainty is null.

## Decision

**An iNaturalist observation is decomposed into its parts, not read as one verdict.** The parts are:
- the **evidence** the observer submitted: the photos and sounds, and the when and where;
- the **observer's own identification**;
- **every other identification**, each with who made it.

**Our confidence in an identification is ours to derive** from those parts, as decision [014](014-trust-and-curation-model.md) already says of any claim: claims have status, people have reputation, and curators assert both. iNaturalist's community taxon and quality grade are not adopted as our finding. Their rules need not be ours. They may be kept as data, to compare against, but they decide nothing here.

**Expertise is the person's, not the platform's.** Someone we trust to identify a harbour porpoise from a photo is just as trustworthy on iNaturalist, on our own form, or quoted in a Maplify report. Reputation (014) attaches to a person across the places they identify, so an identifier on iNaturalist has to be recognisable as the same person elsewhere.

## Not decided here

- **How confidence is computed** from the evidence, the identifications and the identifiers' reputations. That's a rule we write, and it gets its own record.
- **Where expertise comes from**: a curated list, a register of identifiers, something else. 014 left reputation unmodelled, and it still is.
- **How a person is linked across platforms.** An iNaturalist login, a Maplify username and a SalishSea.io contributor are three identities until something joins them.
- **What the Darwin Core archive says.** Once there is a confidence of ours, `identificationVerificationStatus` and `identificationQualifier` come from it (054's rule for hedges still holds). iNaturalist records stay out of the archive regardless ([005](005-export-exclusion-src-01.md)).

## Consequences

- The iNaturalist mirror needs each observation's identifications (identifier, taxon, when, whether current), not only its current taxon. The rolling refresh can backfill them. The rights policy needs checking for identifications before they're stored ([rights-policy](../rights-policy.md)); they are in the public API and in GBIF's export of research-grade records.
- Until the rule exists, nothing changes on the map: the iNaturalist arm's certainty stays null.

## Rejected

- **Map quality grade onto certainty** (Research Grade → `certain`, Needs ID → `possible`). It would make "the asserter" mean iNaturalist's community, and put iNaturalist's rules inside our hedge.
- **Carry quality grade as its own upstream-verification field.** Better labelled, but it still imports a verdict where we want the claims it was computed from.
- **Adopt the community taxon as the occurrence's species.** Same objection: a derived value, derived by rules that aren't ours.
