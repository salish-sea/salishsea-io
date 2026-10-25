# 089 — The sighting form offers what an observer can say, above and below species

**Status:** accepted · **Decided:** 2026-10-24 · **Work:** bd `salish-0m8t`, [#761](https://github.com/salish-sea/salishsea-io/issues/761) · **Extends:** [048](048-our-sightings-are-keyed-on-the-register.md) (our sightings are keyed on the register)

## Context

Scott Veirs wanted to record a Facebook post that said only "Baleen whale off San Juan county park". The form's menu had a "Baleen whales" heading but no way to choose it, so the only options were to guess a species or not record the sighting. He also could not record a sighting as Southern Resident, although the menu offered Resident and Bigg's.

The register already holds both: Mysticeti, `SSA:0000935`, named "Baleen whale", and the Southern Resident community, `SSA:0000010`. Every entity a sighting records reaches an iNaturalist taxon through the register's crosswalk ([048](048-our-sightings-are-keyed-on-the-register.md)), so the map can draw these and the Darwin Core archive can classify them. Maplify's sightings already resolve to the Southern Resident community.

## Decision

- **Each group in the menu starts with the broadest thing an observer can say about it**, where the register holds an entity for it: "Killer whale" (already there), "Baleen whale" and "Otter" (Lutrinae, `SSA:0000939`). Someone who can't tell a humpback from a minke at that distance says so.
- **Southern Resident joins the killer whales**, after Resident.
- **The "Baleen whales" heading becomes "Whales"**, because it holds the sperm whale and now also an option called "Baleen whale". A heading named after one option, holding an animal that isn't one, would read as a claim.
- **The field is labelled "Animal", not "Species"**, because not every option is a species.

## Not offered, and why

- **Pinniped** (`SSA:0000938`). The register's crosswalk takes it to iNaturalist's Phocoidea as a close match, which is a misnomer ([027](027-marine-mammal-scope-whale-centric-identity.md)): the map draws it as an unknown marine mammal, and GBIF can't match it. Offering it would put grey dots on the map for seals and sea lions. It can be offered once the map and the archive have an honest place for it.
- **Northern Residents.** The register has no entity for them; whether to add Northern Residents and offshores now is its open question Q4 ([salish-sea/animals#4](https://github.com/salish-sea/animals/issues/4)). When the register adds the community, the form offers it beside Southern Resident.
- **Cetacean** (`SSA:0000934`), for "a whale or dolphin, kind unknown". No one has asked for it, and it fits no group heading.
