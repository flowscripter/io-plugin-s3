import { S3Client } from "@aws-sdk/client-s3";
import type { S3Config } from "../schema/s3ConfigSchema.ts";

/** Creates the AWS SDK client for a provider config. */
export function createS3Client(config: S3Config): S3Client {
  const credentials =
    config.accessKeyId !== undefined && config.secretAccessKey !== undefined
      ? {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          sessionToken: config.sessionToken,
        }
      : undefined;
  return new S3Client({
    region: config.region ?? (config.endpoint === undefined ? undefined : "us-east-1"),
    endpoint: config.endpoint,
    forcePathStyle: config.endpoint !== undefined,
    credentials,
  });
}
