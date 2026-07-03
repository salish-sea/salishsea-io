# iNaturalist ingest taxa — reference

The iNaturalist ingest (`inaturalist.update_observations`) fetches observations under a fixed list of iNaturalist **taxon IDs**. This is the cheat-sheet for what those numeric IDs actually mean, so nobody has to guess (a wrong guess about `372843` once mislabelled pinnipeds as "not ingested" — see [decision 009](../decisions/009-taxonomic-scope-marine-mammals.md)).

**Source of truth:** the `array[…]` in the most recent `inaturalist.update_observations` definition under [`supabase/migrations/`](../../supabase/migrations/) (the taxon set was last set in `20260526000000_inat_add_lutrinae.sql`). Update the table below in the same change that edits that array.

## Current ingest taxa

| iNat ID | Scientific name | Rank | Common name | PSEMP group |
|---|---|---|---|---|
| `152871` | Cetacea | infraorder | Cetaceans | cetaceans |
| `372843` | Phocoidea | superfamily | **Pinnipeds** (children: Phocidae, Otariidae, Odobenidae) | pinnipeds |
| `526556` | Lutrinae | subfamily | Otters | mustelids |

Together these cover the [PSEMP Marine Mammal Working Group](../decisions/009-taxonomic-scope-marine-mammals.md) taxonomic scope. A taxon ID captures its entire subtree, so `372843` (Phocoidea) pulls all seals, sea lions, and walrus — not just true seals.

## Verifying an ID

Any iNaturalist taxon ID resolves via the public API (no auth):

```sh
curl -s https://api.inaturalist.org/v1/taxa/372843 | jq '.results[0] | {name, rank, preferred_common_name}'
```

Add `.children[].name` to that filter to see what a higher-rank taxon actually subsumes before assuming its members are in or out of scope.
