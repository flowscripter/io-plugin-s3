import { z } from "zod";

/** Provider-specific entry properties reported in `EntryProperties.properties`. */
export const s3PropertySchema = z.object({
  etag: z.string().optional(),
  storageClass: z.string().optional(),
  tags: z.record(z.string(), z.string()).optional(),
});
