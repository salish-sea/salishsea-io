import z from "zod";
import { db } from "../database.ts";
import fs from 'node:fs/promises';

const speciesSchema = z.object({
  code: z.string(), // also called 'key'
  name: z.string(),
  plural: z.string(),
  // icon: z.string().nullable(),
  scientific: z.string().nullable(),
});
export type Species = {
  code: string;
  name: string;
  plural: string;
  scientific: string;
}
const encounterConfigSchema = z.object({
  species: z.array(speciesSchema),
  // defaultSpecies
  // individual
  // encounter
  // idAgencies
  // idServices
  // externalIDApps
});

function isSpecies(species: z.infer<typeof speciesSchema>): species is Species {
  return species.scientific !== null;
}

export const fetchSpecies = async (location?: string): Promise<Species[] | null> => {
  let body: unknown;
  if (location) {
    const file = await fs.readFile(location, 'utf8');
    body = JSON.parse(file);
  } else {
    const request = new Request("https://happywhale.com/app/cs/encounter/config", {headers: {Accept: 'application/json'}});
    const response = await fetch(request);
    if (response.status === 404)
      return null;
    if (!response.ok)
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    body = await response.json();
  }
  const payload = encounterConfigSchema.parse(body);
  const spp = payload.species.filter(isSpecies);
  return spp;
}

type SpeciesRow = {
  code: string;
  scientific_name: string;
};
const upsertSpeciesQuery = db.prepare<SpeciesRow>(`
INSERT INTO happywhale_species (code, scientific_name)
VALUES (@code, @scientific_name)
ON CONFLICT (code) DO UPDATE SET
scientific_name=@scientific_name
WHERE code=@code
`);
export const upsertSpecies = db.transaction((rows: SpeciesRow[]) => {
  for (const row of rows) {
    upsertSpeciesQuery.run(row);
  }
});
export const ingestSpecies: (species: Species) => SpeciesRow = (species) => {
  return {
    code: species.code,
    scientific_name: species.scientific,
  }
};
