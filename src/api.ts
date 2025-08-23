import { z } from 'zod';

export const sightingSchema = z.object({
  body: z.string().nullable(),
  count: z.coerce.number().int().positive().nullable(),
  direction: z.string().nullable(),
  observed_at: z.string(),
  observer_location: z.tuple([z.number(), z.number()]).nullable(),
  photos: z.array(z.string()).default([]),
  photo_license: z.string(),
  subject_location: z.tuple([z.number(), z.number()]),
  taxon: z.string(),
  url: z.string().trim().transform(s => s === '' ? null : s).nullable(),
});
export type SightingPayload = z.infer<typeof sightingSchema>;
