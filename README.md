# io-plugin-s3

[![version](https://img.shields.io/github/v/release/flowscripter/io-plugin-s3?sort=semver)](https://github.com/flowscripter/io-plugin-s3/releases)
[![build](https://img.shields.io/github/actions/workflow/status/flowscripter/io-plugin-s3/release-bun-library.yml)](https://github.com/flowscripter/io-plugin-s3/actions/workflows/release-bun-library.yml)
[![docs](https://img.shields.io/badge/docs-API-blue)](https://flowscripter.github.io/io-plugin-s3/index.html)
[![license: MIT](https://img.shields.io/github/license/flowscripter/io-plugin-s3)](https://github.com/flowscripter/io-plugin-s3/blob/main/LICENSE)

> Amazon S3 source/sink plugin for
> [pluggable-io-framework](https://github.com/flowscripter/pluggable-io-framework),
> loaded via
> [dynamic-plugin-framework](https://github.com/flowscripter/dynamic-plugin-framework)

## Key Features

- A provider factory for the `s3` protocol with the `js` payload kind,
  built on the AWS SDK (`@aws-sdk/client-s3` and `@aws-sdk/lib-storage`).
- Self-contained locations: `bucket`, `region`, `endpoint`, `path`, an
  optional `filename` or glob `pattern`, and optional credentials
  (`accessKeyId`, plus `secretAccessKey` and `sessionToken` marked
  secret). Without credentials the AWS SDK's default provider chain is used.
- Works with S3-compatible stores: an `endpoint` switches to path-style
  addressing.
- Containers are key prefixes; listing uses `ListObjectsV2` with a `/`
  delimiter, and `createContainer` writes the conventional `key/` marker.
- Readable handles are `RangeReadable` through ranged `GetObject` requests.
- Writes stream through the SDK's `Upload`, and multipart transfers use a
  real S3 multipart upload within S3's limits (5 MiB to 5 GiB parts, at most
  10000 parts).
- The multipart writer is resumable: its token holds the upload id and
  completed parts, and resuming confirms them with `ListParts`.
- Server-side `CopyObject` for copies and moves within a bucket.
- `getProperties` reports size, last modified, content type, etag, storage
  class and tags; `setProperties` changes content type, storage class and
  tags.

## Usage

Install the plugin where a
[pluggable-io-framework](https://github.com/flowscripter/pluggable-io-framework)
host discovers plugins, then address objects with `s3://` locations
(`registry` is a discovered `ProviderRegistry`):

```typescript
const { source, dest, options } = await registry.createProvidersForTransfer(
  "file:///tmp/report.csv",
  "s3://media/reports/",
);
await copy(source.provider, source.target, dest.provider, dest.target, options);
```

## Further Details

- [Configuration](./README/configuration.md)
- [Behaviour](./README/behaviour.md)
- [Development](./README/development.md)
- [API Documentation](https://flowscripter.github.io/io-plugin-s3/index.html)

## License

MIT © Flowscripter
