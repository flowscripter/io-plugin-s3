import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import type {
  Item,
  Part,
  PayloadKind,
  ResumableWritable,
  ResumeToken,
} from "@flowscripter/pluggable-io-framework-api";
import { bytesOf } from "../util/bytesOf.ts";
import { toIOError } from "../util/toIOError.ts";

/** One uploaded part, as recorded in a resume token. */
export interface UploadedPart {
  readonly partNumber: number;
  readonly etag: string;
  readonly size: number;
}

export interface MultipartWriter extends ResumableWritable {
  write(parts: AsyncIterable<Part<PayloadKind.Js>>): Promise<void>;
}

async function listUploadedParts(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<UploadedPart[]> {
  const uploaded: UploadedPart[] = [];
  let marker: string | undefined;
  do {
    const page = await client.send(
      new ListPartsCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      }),
    );
    for (const part of page.Parts ?? []) {
      uploaded.push({
        partNumber: part.PartNumber ?? 0,
        etag: part.ETag ?? "",
        size: part.Size ?? 0,
      });
    }
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker !== undefined);
  return uploaded;
}

/**
 * Writes parts as an S3 multipart upload: part `index` becomes part number
 * `index + 1`, parts upload concurrently as they arrive, and the upload is
 * completed once all have finished.
 *
 * The writer is resumable: its token holds the upload id and the parts
 * uploaded so far, and `offset` is the size of the uploaded parts before
 * the first missing one. A writer created with that token asks S3 which
 * parts it actually has (`ListParts`), skips them, and uploads the rest into
 * the same upload. A failed write waits for the parts already in flight,
 * then leaves the upload open so it can be resumed.
 */
export function createMultipartWriter(
  client: S3Client,
  bucket: string,
  key: string,
  resume?: ResumeToken,
): MultipartWriter {
  const resumeState = resume?.state as { uploadId?: string } | undefined;
  let uploadId = resumeState?.uploadId;
  const uploaded = new Map<number, UploadedPart>();
  const action = `multipart upload to s3://${bucket}/${key}`;

  async function start(): Promise<string> {
    if (uploadId !== undefined) {
      for (const part of await listUploadedParts(client, bucket, key, uploadId)) {
        uploaded.set(part.partNumber, part);
      }
      return uploadId;
    }
    const created = await client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
    );
    uploadId = created.UploadId as string;
    return uploadId;
  }

  async function uploadPart(id: string, part: Part<PayloadKind.Js>): Promise<void> {
    const partNumber = part.index + 1;
    const stream = part.stream as ReadableStream<Item<PayloadKind.Js>>;
    if (uploaded.has(partNumber)) {
      await stream.cancel();
    } else {
      const body = await bytesOf(stream);
      const result = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: id,
          PartNumber: partNumber,
          Body: body,
        }),
      );
      uploaded.set(partNumber, { partNumber, etag: result.ETag ?? "", size: body.byteLength });
    }
    await part.complete();
  }

  return {
    async write(parts) {
      const uploads: Promise<void>[] = [];
      try {
        const id = await start();
        for await (const part of parts) {
          uploads.push(uploadPart(id, part));
        }
        const results = await Promise.allSettled(uploads);
        const failure = results.find((result) => result.status === "rejected");
        if (failure) {
          throw failure.reason;
        }
        const completed = [...uploaded.values()].sort((a, b) => a.partNumber - b.partNumber);
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: id,
            MultipartUpload: {
              Parts: completed.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
            },
          }),
        );
      } catch (error) {
        await Promise.allSettled(uploads);
        throw toIOError(error, action);
      }
    },
    resumeToken() {
      if (uploadId === undefined) {
        return undefined;
      }
      const parts = [...uploaded.values()].sort((a, b) => a.partNumber - b.partNumber);
      let offset = 0;
      for (const [index, part] of parts.entries()) {
        if (part.partNumber !== index + 1) break;
        offset += part.size;
      }
      return {
        offset,
        state: {
          uploadId,
          parts: parts.map((part) => ({
            partNumber: part.partNumber,
            etag: part.etag,
            size: part.size,
          })),
        },
      };
    },
  };
}
