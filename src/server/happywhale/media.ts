import z from "zod";
import { userSchema } from "./user.ts";

export const mediaSchema = z.object({
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
