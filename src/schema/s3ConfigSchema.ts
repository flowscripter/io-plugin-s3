import { z } from "zod";

/**
 * Provider config: the bucket and how to reach it. Without `region`,
 * `accessKeyId` and `secretAccessKey`, the AWS SDK's default provider chain
 * (environment, profile, instance role) supplies them. An `endpoint` selects
 * an S3-compatible store and switches to path-style addressing.
 */
export const s3ConfigSchema = z.object({
  bucket: z.string().min(1),
  region: z.string().optional(),
  endpoint: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional().meta({ secret: true }),
  sessionToken: z.string().optional().meta({ secret: true }),
});

export type S3Config = z.infer<typeof s3ConfigSchema>;
