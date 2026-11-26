# io-plugin-s3 notes

- Local repo created for pluggable-io-framework#18 Plan 3; Nick pushes it himself. Do not push or add remotes.
- `getMultipartWriter(key, partSize, opts?: { resume })` returns the API's `MultipartWriter<PayloadKind.Js> & ResumableWritable` (needs api ^3.1.0, commit e0d5c81); `bun.lock` still pins api 3.0.0 until 3.1.0 is published.
