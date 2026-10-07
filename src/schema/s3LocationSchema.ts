import { z } from "zod";
import { s3ConfigSchema } from "./s3ConfigSchema.ts";

/**
 * An `s3` location: the connection fields of {@link s3ConfigSchema}, a key
 * prefix `path`, and either a `filename` (a single object) or a glob
 * `pattern` (matching objects under `path`). With neither, the location
 * addresses everything under `path`.
 */
export const s3LocationSchema = s3ConfigSchema
  .extend({
    path: z.string().default(""),
    filename: z.string().optional(),
    pattern: z.string().optional(),
  })
  .refine((location) => location.filename === undefined || location.pattern === undefined, {
    message: "filename and pattern are mutually exclusive",
  });

export type S3Location = z.infer<typeof s3LocationSchema>;
