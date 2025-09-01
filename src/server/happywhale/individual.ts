import z from "zod";
import { db } from "../database.ts";

export const individualSchema = z.object({
  id: z.int32().positive(),
  speciesKey: z.string(),
  primaryId: z.string(), // e.g. CRC-15313
  nickname: z.string().nullable(),
  sex: z.enum(['FEMALE', 'MALE']).nullable(),
});
type Individual = z.infer<typeof individualSchema>;

type IndividualRow = {
  identifier: string;
  sex: null | 'f' | 'm';
  species_key: string;
}

const upsertIndividualStmt = db.prepare<IndividualRow>(`
INSERT INTO happywhale_individuals (id, identifier, sex, species_key)
VALUES (@id, @identifier, @sex, @species_key)
ON CONFLICT (id) DO UPDATE SET
identifier=@identifier, sex=@sex, species_key=@species_key
`);

export const upsertIndividuals = db.transaction((rows: IndividualRow[]) => {
  for (const row of rows)
    upsertIndividualStmt.run(row);
});

const sexLookup = Object.freeze({
  FEMALE: 'f',
  MALE: 'm',
} as const);

export const ingestIndividual: (individual: Individual) => IndividualRow = (individual) => {
  return {
    identifier: individual.primaryId,
    sex: individual.sex && sexLookup[individual.sex] || null,
    species_key: individual.speciesKey,
  }
}
