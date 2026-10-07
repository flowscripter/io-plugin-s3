import { describe, expect, test } from "bun:test";
import {
  type Item,
  type Part,
  PayloadKind,
  TransientIOError,
} from "@flowscripter/pluggable-io-framework-api";
import { createMultipartWriter } from "../../src/stream/createMultipartWriter.ts";
import { createFakeS3 } from "../fixtures/fakeS3.ts";

function part(index: number, text: string, completed: number[] = []): Part<PayloadKind.Js> {
  return {
    index,
    offset: index * 2,
    kind: PayloadKind.Js,
    stream: new ReadableStream<Item<PayloadKind.Js>>({
      start(controller) {
        controller.enqueue({
          payload: { kind: PayloadKind.Js, data: new TextEncoder().encode(text) },
        });
        controller.close();
      },
    }),
    complete: async () => {
      completed.push(index);
    },
  };
}

async function* parts(...items: Part<PayloadKind.Js>[]): AsyncGenerator<Part<PayloadKind.Js>> {
  yield* items;
}

describe("createMultipartWriter", () => {
  test("uploads parts as part numbers index + 1 and completes the upload", async () => {
    const s3 = createFakeS3();
    const writer = createMultipartWriter(s3.client, "bucket", "a.bin");
    expect(writer.resumeToken()).toBeUndefined();
    const completed: number[] = [];
    await writer.write(parts(part(1, "cd", completed), part(0, "ab", completed)));
    expect(s3.text("a.bin")).toBe("abcd");
    expect(completed.sort()).toEqual([0, 1]);
  });

  test("a failed part leaves the upload open with a resume token for the parts done", async () => {
    const s3 = createFakeS3();
    const writer = createMultipartWriter(s3.client, "bucket", "a.bin");
    let calls = 0;
    const send = s3.client.send.bind(s3.client);
    s3.client.send = (async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "UploadPartCommand") {
        calls += 1;
        if (calls === 2) {
          throw Object.assign(new Error("slow down"), { $metadata: { httpStatusCode: 503 } });
        }
      }
      return send(command as never);
    }) as typeof s3.client.send;

    await expect(
      writer.write(parts(part(0, "ab"), part(1, "cd"), part(2, "ef"))),
    ).rejects.toBeInstanceOf(TransientIOError);
    const token = writer.resumeToken();
    expect(token?.offset).toBe(2);
    expect(token?.state).toEqual({
      uploadId: "upload-1",
      parts: [
        { partNumber: 1, etag: '"upload-1-1"', size: 2 },
        { partNumber: 3, etag: '"upload-1-3"', size: 2 },
      ],
    });
    expect(s3.uploads.has("upload-1")).toBe(true);

    s3.client.send = send as typeof s3.client.send;
    const resumed = createMultipartWriter(s3.client, "bucket", "a.bin", token);
    s3.calls.length = 0;
    await resumed.write(parts(part(0, "ab"), part(1, "cd"), part(2, "ef")));
    expect(s3.text("a.bin")).toBe("abcdef");
    expect(s3.calls.filter((name) => name === "UploadPartCommand").length).toBe(1);
    expect(s3.calls.filter((name) => name === "ListPartsCommand").length).toBe(2);
  });

  test("a failing source waits for parts in flight before reporting", async () => {
    const s3 = createFakeS3();
    const writer = createMultipartWriter(s3.client, "bucket", "a.bin");
    async function* failing(): AsyncGenerator<Part<PayloadKind.Js>> {
      yield part(0, "ab");
      throw new Error("source failed");
    }
    await expect(writer.write(failing())).rejects.toThrow("source failed");
    expect(writer.resumeToken()?.offset).toBe(2);
  });
});
