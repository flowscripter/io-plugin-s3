import { z } from "zod";

/**
 * The provider-specific entry properties accepted by `setProperties`.
 * `tags` replaces the object's whole tag set.
 */
export const s3SettablePropertySchema = z.object({
  storageClass: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
