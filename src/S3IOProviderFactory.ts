import { type IOProviderFactory, PayloadKind } from "@flowscripter/pluggable-io-framework-api";
import { parseS3LocationString } from "./location/parseS3LocationString.ts";
import { toS3ProviderInputs } from "./location/toS3ProviderInputs.ts";
import { S3IOProvider } from "./S3IOProvider.ts";
import { type S3Config, s3ConfigSchema } from "./schema/s3ConfigSchema.ts";
import { type S3Location, s3LocationSchema } from "./schema/s3LocationSchema.ts";
import { s3PropertySchema } from "./schema/s3PropertySchema.ts";
import { s3SettablePropertySchema } from "./schema/s3SettablePropertySchema.ts";

export const s3IOProviderFactory: IOProviderFactory<S3Config, PayloadKind.Js, S3Location> = {
  protocol: "s3",
  kind: PayloadKind.Js,
  configSchema: s3ConfigSchema,
  locationSchema: s3LocationSchema,
  propertySchema: s3PropertySchema,
  settablePropertySchema: s3SettablePropertySchema,
  parseLocationString: parseS3LocationString,
  toProviderInputs: toS3ProviderInputs,
  async createProvider(config) {
    return new S3IOProvider(config);
  },
};
