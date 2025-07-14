import type Database from 'better-sqlite3';

export type Taxon = {
  id: number;
  parent_id: number | null;
  scientific_name: string;
  taxon_rank: string;
  updated_at: number; // unix epoch seconds
  vernacular_name: string | null;
  species_id: number | null;
};

// taxon id -> vernacular name
export type VernacularName = [number, string];

export function importTaxa(taxa: Taxon[], db: Database.Database) {
  const upsertTaxonStmt = db.prepare<Taxon>(`
    INSERT INTO taxa (id, parent_id, scientific_name, taxon_rank, updated_at, vernacular_name, species_id)
    VALUES (@id, @parent_id, @scientific_name, @taxon_rank, @updated_at, @vernacular_name, @species_id)
    ON CONFLICT(id) DO UPDATE SET
      parent_id=excluded.parent_id,
      scientific_name=excluded.scientific_name,
      taxon_rank=excluded.taxon_rank,
      updated_at=excluded.updated_at,
      vernacular_name=excluded.vernacular_name,
      species_id=excluded.species_id
  `);
  const importTxn = db.transaction((taxa: Taxon[]) => {
    for (const taxon of taxa) {
      upsertTaxonStmt.run(taxon);
    }
  });
  importTxn(taxa);
}
