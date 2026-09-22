# 048 — Our own sightings are keyed on the register

**Status:** accepted · **Decided:** 2026-09-22 · **Extends:** [033](033-register-names-the-animals.md) · **Answers:** `salish-53t.3` (the `public.observations` half)

## Decision

**A sighting reported through SalishSea.io records a register entity (`observations.entity_id`, an `SSA:` identifier), not an iNaturalist taxon id.** The sighting form offers entities and shows the register's name for each; `upsert_observation` stores the entity; `observations.taxon_id` is gone.

Where something downstream still speaks iNaturalist's vocabulary — the map's symbology groups by scientific name, and the DarwinCore archive's classification is keyed on iNaturalist taxa — the entity is translated at read time through the register's crosswalk, by `register.inaturalist_taxon_for`: the entity's own exact or close match first, then its taxon's.

## Why

The form was asking the register's question and storing iNaturalist's answer. "Bigg's killer whale" is an ecotype, `SSA:0000002`; iNaturalist can only approximate it with the subspecies *Orcinus orca rectipinnus*, and the form reached even that by looking a scientific-name string up in the iNaturalist mirror — a dictionary for data that is not iNaturalist's. The menu's labels were a table of names we had written ourselves, which is what 033 forbids.

**The entity's own mapping comes first** so an ecotype keeps its precision. Resolving through the taxon an entity belongs to (as `register.taxon_for` does) would turn all 222 Bigg's and 195 Resident sightings into plain *Orcinus orca* — in the archive, and on the map, where `src/symbology.ts` labels a track "Biggs" or "Resident" from the scientific name.

## Consequences

- **The archive is unchanged for 557 of 579 sightings** (production, 2026-09-22). The other 22 — 20 *Phoca vitulina richardii*, 2 *Eumetopias jubatus monteriensis* — were iNaturalist subspecies the register does not hold, and are now published at species rank. The form's sea otter option, *Enhydra lutris kenyoni*, becomes the species the same way.
- **Four menu labels change** to the register's: "Killer whale (unknown ecotype)" → "Killer whale", "Harbor seal" → "Harbour seal", "Harbor porpoise" → "Harbour porpoise", "Elephant seal" → "Northern elephant seal". Losing "(unknown ecotype)" is the one a reporter might notice; if it is missed, the fix is a register name or a UI hint beside the menu, not a label of ours.
- **No foreign key into `register.entities`**, as with `individuals.entity_id`: the register is reloaded wholesale each edition. A CHECK holds the identifier's shape.
- **A sighting of an entity the crosswalk cannot reach still appears on the map**, unnamed; the view's taxa joins are LEFT. In the archive it would be dropped (the classification join is inner), and `dwc.export_coverage` counts it under `no_taxon`.
- **CI seeds one register entity** (`SSA:0000900` and its exactMatch) so its native sighting can be classified. Tests that need a real edition now probe `register.edition`, not `register.entities`.

## Rejected alternatives

- **Keep `taxon_id`, filled from the entity, and re-key the archive later.** Smaller, and would have left the export untouched. Rejected by Peter: a temporarily broken export was an acceptable price for not carrying two keys.
- **Resolve through `register.taxon_for`.** It answers what an entity belongs to, not what it is; see *Why*.
