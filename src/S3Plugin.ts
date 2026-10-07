import { PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT } from "@flowscripter/pluggable-io-framework-api";
import type { Plugin } from "@flowscripter/dynamic-plugin-framework/plugin";
import { s3IOProviderFactory } from "./S3IOProviderFactory.ts";

/** Registers the `s3` provider factory. */
const s3Plugin: Plugin = {
  extensionDescriptors: [
    {
      extensionPoint: PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
      factory: { create: () => Promise.resolve(s3IOProviderFactory) },
    },
  ],
};

export default s3Plugin;
