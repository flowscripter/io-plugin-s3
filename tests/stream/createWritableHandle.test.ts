import { describe, expect, test } from "bun:test";
import { type Item, PayloadKind, TransientIOError } from "@flowscripter/pluggable-io-framework-api";
import { createWritableHandle } from "../../src/stream/createWritableHandle.ts";
import { createFakeS3 } from "../fixtures/fakeS3.ts";

function item(data: Uint8Array): Item<PayloadKind.Js> {
  return { payload: { kind: PayloadKind.Js, data } };
}

describe("createWritableHandle", () => {
  test("a small body is uploaded with one PutObject", async () => {
    const s3 = createFakeS3();
    const handle = createWritableHandle(s3.client, "bucket", "a.txt");
    const writer = (handle.stream as WritableStream<Item<PayloadKind.Js>>).getWriter();
    await writer.write(item(new TextEncoder().encode("hello")));
    await writer.close();
    expect(s3.text("a.txt")).toBe("hello");
    expect(s3.calls).toContain("PutObjectCommand");
  });

  test("a large body is uploaded as a multipart upload", async () => {
    const s3 = createFakeS3();
    const handle = createWritableHandle(s3.client, "bucket", "big.bin");
    const writer = (handle.stream as WritableStream<Item<PayloadKind.Js>>).getWriter();
    const chunk = new Uint8Array(1024 * 1024).fill(7);
    for (let i = 0; i < 7; i += 1) {
      await writer.write(item(chunk));
    }
    await writer.close();
    expect(s3.objects.get("big.bin")?.data.byteLength).toBe(7 * 1024 * 1024);
    expect(s3.calls).toContain("CompleteMultipartUploadCommand");
  });

  test("a failed upload fails on close", async () => {
    const s3 = createFakeS3();
    s3.failNext("PutObjectCommand", 503);
    const handle = createWritableHandle(s3.client, "bucket", "a.txt");
    const writer = (handle.stream as WritableStream<Item<PayloadKind.Js>>).getWriter();
    await writer.write(item(new TextEncoder().encode("x")));
    await expect(writer.close()).rejects.toBeInstanceOf(TransientIOError);
  });

  test("aborting cancels the upload", async () => {
    const s3 = createFakeS3();
    const handle = createWritableHandle(s3.client, "bucket", "a.txt");
    const writer = (handle.stream as WritableStream<Item<PayloadKind.Js>>).getWriter();
    await writer.abort(new Error("stop"));
    expect(s3.objects.has("a.txt")).toBe(false);
  });
});
