import z from "zod";


export const userSchema = z.object({
  id: z.int32(),
  // uuid
  // hexId
  displayName: z.string(),
  // avatar
  // geoloc
});
