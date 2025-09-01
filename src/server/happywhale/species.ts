import z from "zod";
import { db } from "../database.ts";

const speciesSchema = z.object({
  code: z.string(), // also called 'key'
  name: z.string(),
  plural: z.string(),
  icon: z.string().nullable(),
  scientific: z.string(),
});
export type Species = z.infer<typeof speciesSchema>;
const encounterConfigSchema = z.object({
  species: z.array(speciesSchema),
  // defaultSpecies
  // individual
  // encounter
  // idAgencies
  // idServices
  // externalIDApps
});

export const fetchSpecies = async () => {
  const request = new Request("https://happywhale.com/app/cs/encounter/config", {headers: {Accept: 'application/json'}});
  const response = await fetch(request);
  if (response.status === 404)
    return null;
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const body = await response.json();
  const payload = encounterConfigSchema.parse(body);
  return payload.species;
}

type SpeciesRow = {
  code: string;
  scientific_name: string;
};
const upserSpeciesQuery = db.prepare<SpeciesRow>(`
INSERT INTO happywhale_species (key, scientific_name)
VALUES (@code, @scientific_name)
ON CONFLICT (code) DO UPDATE SET
scientific_name=@scientific_name,
WHERE code=@code
`);
export const upsertSpecies = db.transaction((rows: SpeciesRow[]) => {
  for (const row of rows) {
    upserSpeciesQuery.run(row);
  }
});
export const ingestSpecies: (species: Species) => SpeciesRow = (species) => {
  return {
    code: species.code,
    scientific_name: species.scientific,
  }
};
