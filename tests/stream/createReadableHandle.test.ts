import { describe, expect, test } from "bun:test";
import {
  isRangeReadable,
  type Item,
  type PayloadKind,
  PermanentIOError,
  TransientIOError,
} from "@flowscripter/pluggable-io-framework-api";
import { createReadableHandle } from "../../src/stream/createReadableHandle.ts";
import { createFakeS3 } from "../fixtures/fakeS3.ts";

async function text(stream: ReadableStream<Item<PayloadKind.Js>>): Promise<string> {
  return new TextDecoder().decode(
    Buffer.concat(
      await Array.fromAsync(stream as unknown as AsyncIterable<Item<PayloadKind.Js>>, (item) =>
        item.payload.kind === "js" ? item.payload.data : new Uint8Array(),
      ),
    ),
  );
}

describe("createReadableHandle", () => {
  test("is RangeReadable with an exclusive end, clamping and empty ranges", async () => {
    const s3 = createFakeS3();
    s3.put("a", "0123456789");
    const handle = await createReadableHandle(s3.client, "bucket", "a");
    expect(isRangeReadable(handle)).toBe(true);
    expect(await text(await handle.readRange(8, Number.MAX_SAFE_INTEGER))).toBe("89");
    expect(await text(await handle.readRange(5, 100))).toBe("56789");
    expect(await text(await handle.readRange(4, 4))).toBe("");
    expect(await text(await handle.readRange(20, 30))).toBe("");
  });

  test("a missing object is permanent and a failed range read is reported", async () => {
    const s3 = createFakeS3();
    await expect(createReadableHandle(s3.client, "bucket", "missing")).rejects.toBeInstanceOf(
      PermanentIOError,
    );
    s3.put("a", "x");
    const handle = await createReadableHandle(s3.client, "bucket", "a");
    s3.failNext("GetObjectCommand", 500);
    await expect(handle.readRange(0, 1)).rejects.toBeInstanceOf(TransientIOError);
  });

  test("an object without a body reads as empty", async () => {
    const s3 = createFakeS3();
    s3.client.send = (async () => ({})) as typeof s3.client.send;
    const handle = await createReadableHandle(s3.client, "bucket", "a");
    expect(await text(handle.stream as ReadableStream<Item<PayloadKind.Js>>)).toBe("");
  });
});
