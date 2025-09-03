import z from "zod";
import { individualSchema } from "./individual.ts";
import { userSchema } from "./user.ts";
import { mediaSchema } from "./media.ts";
import { Temporal } from "temporal-polyfill";

const encounterFullSchema = z.object({
  encounter: z.object({
    id: z.int32().positive(),
    dateRange: z.object({
      startDate: z.string(),
      startTime: z.string().nullable(),
      endDate: z.date().nullable(),
      endTime: z.string().nullable(),
      timezone: z.string(),
    }),
    location: z.object({
      verbatimLocation: z.string(),
      latLng: z.object({
        lat: z.number(),
        lng: z.number(),
      }),
      accuracy: z.enum(['GENERAL', 'APPROX', 'PRECISE']),
      precisionSource: z.string().nullable(),
    }),
    region: z.string(),
    individual: individualSchema,
    species: z.string(),
    minCount: z.int().positive().nullable(),
    maxCount: z.int().positive().nullable(),
    comments: z.string().nullable(),
    displayImage: mediaSchema.nullable(),
    user: userSchema.nullable(),
    // org
    public: z.boolean(),
  }),
  media: z.array(z.object({
    media: mediaSchema,
    // detection
  })),
  // comments
  // surveys
  contributors: z.array(userSchema),
  // sighters
  // geneticSamples
  // externalIds
  // editable
});
type Encounter = z.infer<typeof encounterFullSchema>;

export const fetchEncounter = async (id: number) => {
  const url = `https://happywhale.com/app/cs/encounter/full/${id}`;
  const request = new Request(url, {headers: {Accept: 'application/json'}});
  const response = await fetch(request);
  if (response.status === 404)
    return null;
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  const body = await response.json();
  const payload = encounterFullSchema.parse(body);
  return payload;
}

type EncounterRow = {
  id: number;
  longitude: number;
  latitude: number;
  timestamp: number;
  species_key: string;
  min_count: number | null;
  max_count: number | null;
  individual_id: number | null;
}

export function ingestEncounter({encounter, media, contributors}: Encounter) {
  const time = Temporal.PlainTime.from(encounter.dateRange.startTime ?? '12:00:00');
  const encounterTimestamp = Temporal.PlainDate.from(encounter.dateRange.startDate).toZonedDateTime({
    plainTime: time,
    timeZone: encounter.dateRange.timezone,
  });
  return {
    id: encounter.id,
    longitude: encounter.location.latLng.lng,
    latitude: encounter.location.latLng.lat,
    timestamp: encounterTimestamp.toInstant().epochMilliseconds,
    species_key: encounter.species,
    min_count: encounter.minCount,
    max_count: encounter.maxCount,
    individual_id: encounter.individual.id,
  }
}
