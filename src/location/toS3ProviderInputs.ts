import type { LocationTarget } from "@flowscripter/pluggable-io-framework-api";
import type { S3Config } from "../schema/s3ConfigSchema.ts";
import type { S3Location } from "../schema/s3LocationSchema.ts";
import { joinS3Key, normalizeS3Key } from "../util/s3Key.ts";

/**
 * Splits a validated location into the connection config and a
 * `LocationTarget` whose keys are `/`-joined object keys without a
 * leading `/`.
 */
export function toS3ProviderInputs(location: S3Location): {
  config: S3Config;
  target: LocationTarget;
} {
  const { path, filename, pattern, ...config } = location;
  if (filename !== undefined) {
    return { config, target: { kind: "entry", key: joinS3Key(path, filename) } };
  }
  if (pattern !== undefined) {
    return { config, target: { kind: "pattern", containerKey: normalizeS3Key(path), pattern } };
  }
  return { config, target: { kind: "container", key: normalizeS3Key(path) } };
}
