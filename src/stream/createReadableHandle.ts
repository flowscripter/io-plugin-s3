import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  fromWebReadableStream,
  type Item,
  PayloadKind,
  type RangeReadable,
  type StreamHandle,
} from "@flowscripter/pluggable-io-framework-api";
import { statusOf, toIOError } from "../util/toIOError.ts";

function emptyStream(): ReadableStream<Item<PayloadKind.Js>> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

async function getObject(
  client: S3Client,
  bucket: string,
  key: string,
  range?: string,
): Promise<ReadableStream<Item<PayloadKind.Js>> | undefined> {
  try {
    const output = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
    );
    const body = output.Body?.transformToWebStream() as ReadableStream<Uint8Array> | undefined;
    return body === undefined ? emptyStream() : fromWebReadableStream(body);
  } catch (error) {
    if (range !== undefined && statusOf(error) === 416) {
      return undefined;
    }
    throw toIOError(error, `GetObject s3://${bucket}/${key}`);
  }
}

/**
 * Opens a readable handle for an object. `readRange(start, end)` (`end`
 * exclusive) sends a `GetObject` with a `Range` header; a range at or past
 * the end of the object is an empty stream.
 */
export async function createReadableHandle(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<StreamHandle<PayloadKind.Js> & RangeReadable<PayloadKind.Js>> {
  const stream = (await getObject(client, bucket, key)) as ReadableStream<Item<PayloadKind.Js>>;
  return {
    kind: PayloadKind.Js,
    stream,
    async readRange(start: number, end: number) {
      if (end <= start) {
        return emptyStream();
      }
      const last = end >= Number.MAX_SAFE_INTEGER ? "" : String(end - 1);
      return (await getObject(client, bucket, key, `bytes=${start}-${last}`)) ?? emptyStream();
    },
  };
}
