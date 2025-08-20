import { z } from 'zod';

export const sightingSchema = z.object({
  body: z.string(),
  count: z.coerce.number().int().positive().optional().nullable(),
  direction: z.string().nullable(),
  observed_at: z.string(),
  observer_location: z.tuple([z.number(), z.number()]).optional(),
  photos: z.array(z.string()).default([]),
  photo_license: z.string(),
  subject_location: z.tuple([z.number(), z.number()]),
  taxon: z.string(),
  url: z.string().trim().transform(s => s === '' ? undefined : s).nullish(),
});
export type SightingPayload = z.infer<typeof sightingSchema>;
