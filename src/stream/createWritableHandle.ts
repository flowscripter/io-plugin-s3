import { PassThrough } from "node:stream";
import type { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import {
  type Item,
  PayloadKind,
  type StreamHandle,
} from "@flowscripter/pluggable-io-framework-api";
import { toIOError } from "../util/toIOError.ts";

/**
 * Opens a writable handle that streams items to an object through the AWS
 * SDK's `Upload`, which sends one `PutObject` or, for larger bodies, a
 * multipart upload. Closing completes the upload; aborting cancels it. This
 * path has no resume token, so a failed write restarts.
 */
export function createWritableHandle(
  client: S3Client,
  bucket: string,
  key: string,
): StreamHandle<PayloadKind.Js> {
  const body = new PassThrough();
  const upload = new Upload({ client, params: { Bucket: bucket, Key: key, Body: body } });
  const done = upload.done().then(
    () => {},
    (error: unknown) => {
      throw toIOError(error, `Upload s3://${bucket}/${key}`);
    },
  );
  // Rejections are reported by close() or the next write().
  done.catch(() => {});

  return {
    kind: PayloadKind.Js,
    stream: new WritableStream<Item<PayloadKind.Js>>({
      async write(item) {
        if (!body.write(item.payload.data)) {
          await Promise.race([new Promise((resolve) => body.once("drain", resolve)), done]);
        }
      },
      async close() {
        body.end();
        await done;
      },
      async abort() {
        await upload.abort();
        body.destroy();
      },
    }),
  };
}
