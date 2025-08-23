import { db } from "./database.ts";

export type TaxonRow = {
  id: number;
  parent_id: number | null;
  scientific_name: string;
  taxon_rank: string;
  updated_at: number; // UNIX time
  vernacular_name: string | null;
}

export function species(scientific_name: string) {
  return scientific_name.split(' ').slice(0, 2).join(' ');
}

const taxonByNameQuery = db.prepare<string, TaxonRow>(`
SELECT * FROM taxa WHERE scientific_name=?
`);
export function taxonByName(scientific_name: string) {
  return taxonByNameQuery.get(scientific_name);
}
