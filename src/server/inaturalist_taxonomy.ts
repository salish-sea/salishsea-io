import { parse } from "csv-parse/sync";
import { Temporal } from "temporal-polyfill";
import type { Taxon } from "./taxa.ts";

type TaxonRow = {
  id: string; // integer
  taxonID: string; // URL
  identifier: string; // URL
  parentNameUsageID: string; // URL
  kingdom: string;
  phylum: string;
  class: string;
  order: string;
  family: string;
  genus: string;
  specificEpithet: string;
  infraspecificEpithet: string;
  modified: string;
  scientificName: string;
  taxonRank: string;
  references: string;
};
function readTaxon(row: TaxonRow) {
  // e.g. "https://www.inaturalist.org/taxa/1"
  const parentIdStr = row.parentNameUsageID.substring(34);
  // e.g. "2021-11-02T06:05:44Z"
  const modified = Temporal.Instant.from(row.modified);
  return {
    id: parseFloat(row.id),
    parent_id: parentIdStr && parseFloat(parentIdStr) || null,
    scientific_name: row.scientificName,
    taxon_rank: row.taxonRank,
    updated_at: Math.floor(modified.epochMilliseconds / 1000),
  };
}
function readTaxa(csv: string | Buffer) {
  const lines: TaxonRow[] = parse(csv, {
    columns: true,
  });
  return lines.map(readTaxon);
}

type VernacularNameRow = {
  id: string; // taxon ID
  vernacularName: string;
  language: string;
  locality: string;
  countryCode: string;
  source: string;
  lexicon: string;
  contributor: string;
  created: string;
}
type VernacularNameRecord = {
  taxon_id: number;
  vernacular_name: string;
}
function readVernacularName(row: VernacularNameRow) {
  return {
    taxon_id: parseFloat(row.id),
    vernacular_name: row.vernacularName,
  }
}
function readVernacularNames(csv: string | Buffer): VernacularNameRecord[] {
  const lines: VernacularNameRow[] = parse(csv, {
    columns: true,
  });
  return lines.map(readVernacularName);
}

// Always use the first vernacular name in the file. This is the one iNaturalist itself uses. There is no other way to know which one it uses.
function consolidateVernacularNames(names: VernacularNameRecord[]) {
  const map: {[id: string]: string} = {};
  for (const {taxon_id, vernacular_name} of names) {
    if (!(taxon_id in map))
      map[taxon_id.toString()] = vernacular_name;
  }
  return map;
}

export function readFromINaturalist(taxonCSV: string | Buffer, nameCSV: string | Buffer): Taxon[] {
  const nameLookup = consolidateVernacularNames(readVernacularNames(nameCSV));
  const taxa = readTaxa(taxonCSV).map(taxon => {
    const vernacular_name = nameLookup[taxon.id] || null;
    let species_id: number | null = null;
    if (taxon.taxon_rank === 'subspecies')
      species_id = taxon.parent_id;
    else if (taxon.taxon_rank === 'species')
      species_id = taxon.id;
    return {
      ...taxon,
      species_id,
      vernacular_name,
    }
  });
  return taxa;
}
