# Configuration

## Location Fields

| Field             | Type            | Description                                                        |
| ----------------- | --------------- | ------------------------------------------------------------------ |
| `bucket`          | string          | the bucket                                                         |
| `region`          | string          | the AWS region; defaults to the SDK's provider chain               |
| `endpoint`        | string          | an S3-compatible endpoint; enables path-style addressing           |
| `path`            | string          | the key prefix; defaults to the bucket root                        |
| `filename`        | string          | a single object under `path`                                       |
| `pattern`         | string          | a glob matching objects directly under `path`; excludes `filename` |
| `accessKeyId`     | string          | static credentials; defaults to the SDK's provider chain           |
| `secretAccessKey` | string (secret) | static credentials                                                 |
| `sessionToken`    | string (secret) | temporary credentials                                              |

A location string `s3://<bucket>/<key>` sets `bucket` and `path`. Region,
endpoint and credentials only come from the structured location form.

## Targets

- With `filename`, the location is one object whose key is `path` and
  `filename` joined with `/`.
- With `pattern`, it is the matching objects directly under `path`.
- With neither, it is everything under `path`.

Keys never start with `/`.

## Settable Properties

| Property       | Effect                                                  |
| -------------- | ------------------------------------------------------- |
| `contentType`  | copies the object onto itself with the new content type |
| `storageClass` | copies the object onto itself with the new class        |
| `tags`         | replaces the object's whole tag set                     |

S3 cannot change metadata in place, so content type and storage class
changes copy the object onto itself. `lastModified` is set by S3 and cannot
be changed.
