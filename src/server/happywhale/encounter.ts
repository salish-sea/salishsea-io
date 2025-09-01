import z from "zod";
import { individualSchema } from "./individual.ts";

const userSchema = z.object({
  id: z.int32(),
  // uuid
  // hexId
  displayName: z.string(),
  // avatar
  // geoloc
});
const mediaSchema = z.object({
  id: z.int32().positive(),
  thumbUrl: z.string(),
  url: z.string(),
  // timestamp -- from exif??
  // timezone
  // type -- e.g. "IMAGE"
  // latlng
  // tags
  user: userSchema,
  // orgId
  // submittedOn
  licenseLevel: z.string(), // e.g. "PUBLIC_DOMAIN"
  // parentId
  // rootId
  // latlngSrc
  // attrs
    // idq -- 2
    // idt -- tail_ventral
  // systemAttrs
  // origFilename
  mimetype: z.string(),
  public: z.boolean(),
});
const encounterFullSchema = z.object({
  encounter: z.object({
    id: z.int32().positive(),
    dateRange: z.object({
      startDate: z.date(),
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

}
