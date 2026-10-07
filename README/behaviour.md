# Behaviour

## Containers

A container is a key prefix: `dir` holds every object whose key starts
with `dir/`, and the empty key is the whole bucket.

- `getProperties` reports a key as a container when it has no object of its
  own but has objects under it.
- `list` without `recursive` reports direct children, with sub-prefixes and
  `key/` markers as containers.
- `delete` removes the object at a key and every object under it, in batches
  of 1000. Deleting the whole bucket is refused.

## Reads

`readRange(start, end)` sends `GetObject` with `Range: bytes=<start>-<end - 1>`.
A range at or past the end of the object is an empty stream.

## Writes

`getWritableStream` streams through the SDK's `Upload`, which sends one
`PutObject` for a small body and a multipart upload for a larger one. This
path has no resume token, so a failed write restarts.

`getMultipartWriter` runs an S3 multipart upload directly: part `index`
becomes part number `index + 1`, parts upload concurrently, and the upload
completes once every part has finished.

- Its `resumeToken()` holds the upload id and the uploaded parts. The token's
  `offset` is the size of the parts before the first missing one.
- A failed write waits for the parts in flight and leaves the upload open.
- Passing the token as `getMultipartWriter(key, partSize, { resume })`
  confirms the uploaded parts with `ListParts`, skips them, and uploads the
  rest into the same upload.

Incomplete multipart uploads are kept by S3 (and billed) until completed or
aborted, so a bucket lifecycle rule to abort them after a few days is
recommended.

## Direct Transfers

Two providers for the same bucket, region, endpoint and access key copy and
move with server-side `CopyObject` (limited by S3 to objects of up to
5 GiB). Containers are transferred entry by entry.

## Errors

Failures without a response, timeouts, throttling, server errors and errors
the SDK marks retryable are reported as `TransientIOError`, so the
framework retries them; other failures are `PermanentIOError`.
