import { describe, expect, test } from "bun:test";
import {
  type Item,
  type Part,
  PayloadKind,
  PermanentIOError,
  TransientIOError,
} from "@flowscripter/pluggable-io-framework-api";
import { S3_PART_SIZE_CONSTRAINTS, S3IOProvider } from "../src/S3IOProvider.ts";
import { createFakeS3, type FakeS3 } from "./fixtures/fakeS3.ts";

function setup(pageSize?: number): { s3: FakeS3; provider: S3IOProvider } {
  const s3 = createFakeS3(pageSize);
  return { s3, provider: new S3IOProvider({ bucket: "bucket" }, s3.client) };
}

async function text(stream: ReadableStream<Item<PayloadKind.Js>>): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value.payload.data);
  }
  return Buffer.concat(chunks).toString();
}

async function listPaths(
  provider: S3IOProvider,
  key: string,
  options?: { recursive?: boolean; regex?: RegExp },
): Promise<string[]> {
  const paths: string[] = [];
  for await (const entry of provider.list(key, options)) {
    paths.push(`${entry.path}${entry.properties.isContainer ? "/" : ""}`);
  }
  return paths.sort();
}

describe("S3IOProvider properties", () => {
  test("reports object properties including storage class and tags", async () => {
    const { s3, provider } = setup();
    s3.put("dir/a.txt", "hello");
    s3.objects.get("dir/a.txt")!.tags = [{ Key: "team", Value: "media" }];
    const properties = await provider.getProperties("/dir/a.txt");
    expect(properties.size).toBe(5);
    expect(properties.isContainer).toBe(false);
    expect(properties.properties).toEqual({
      etag: '"dir/a.txt"',
      storageClass: "STANDARD",
      tags: { team: "media" },
    });
  });

  test("a prefix with objects under it, and the bucket root, are containers", async () => {
    const { s3, provider } = setup();
    s3.put("dir/a.txt", "x");
    expect((await provider.getProperties("dir")).isContainer).toBe(true);
    expect((await provider.getProperties("")).isContainer).toBe(true);
    await expect(provider.getProperties("missing")).rejects.toBeInstanceOf(PermanentIOError);
  });

  test("failures other than not found are reported", async () => {
    const { s3, provider } = setup();
    s3.failNext("HeadObjectCommand", 503);
    await expect(provider.getProperties("a")).rejects.toBeInstanceOf(TransientIOError);
  });

  test("setProperties copies the object onto itself and replaces tags", async () => {
    const { s3, provider } = setup();
    s3.put("a.txt", "x");
    await provider.setProperties("a.txt", {
      contentType: "text/plain",
      properties: { storageClass: "STANDARD_IA", tags: { k: "v" } },
    });
    const object = s3.objects.get("a.txt")!;
    expect(object.contentType).toBe("text/plain");
    expect(object.storageClass).toBe("STANDARD_IA");
    expect(object.tags).toEqual([{ Key: "k", Value: "v" }]);
    expect(s3.calls).toContain("CopyObjectCommand");
  });

  test("setProperties only tags when nothing else changes, and rejects lastModified", async () => {
    const { s3, provider } = setup();
    s3.put("a.txt", "x");
    await provider.setProperties("a.txt", { properties: { tags: {} } });
    expect(s3.calls).not.toContain("CopyObjectCommand");
    await expect(provider.setProperties("a.txt", { lastModified: new Date() })).rejects.toThrow(
      "S3 does not allow lastModified to be set",
    );
    await expect(
      provider.setProperties("a.txt", { properties: { storageClass: 1 } }),
    ).rejects.toThrow();
  });
});

describe("S3IOProvider listing", () => {
  test("lists direct children, reporting sub-prefixes and markers as containers", async () => {
    const { s3, provider } = setup();
    s3.put("dir/a.txt", "a");
    s3.put("dir/b.md", "b");
    s3.put("dir/sub/c.txt", "c");
    s3.put("dir/empty/", "");
    s3.put("other.txt", "o");
    expect(await listPaths(provider, "dir")).toEqual(["a.txt", "b.md", "empty/", "sub/"]);
  });

  test("lists recursively across pages and filters by regex", async () => {
    const { s3, provider } = setup(1);
    s3.put("dir/a.txt", "a");
    s3.put("dir/b.md", "b");
    s3.put("dir/sub/c.txt", "c");
    expect(await listPaths(provider, "dir", { recursive: true })).toEqual([
      "a.txt",
      "b.md",
      "sub/c.txt",
    ]);
    expect(await listPaths(provider, "dir", { recursive: true, regex: /\.txt$/ })).toEqual([
      "a.txt",
      "sub/c.txt",
    ]);
    expect(await listPaths(provider, "", { regex: /^dir$/ })).toEqual(["dir/"]);
  });
});

describe("S3IOProvider changes", () => {
  test("delete removes an object and everything under its prefix", async () => {
    const { s3, provider } = setup(1);
    s3.put("dir", "file named like the prefix");
    s3.put("dir/a.txt", "a");
    s3.put("dir/sub/b.txt", "b");
    s3.put("dir/empty/", "");
    s3.put("keep.txt", "k");
    await provider.delete("dir");
    expect([...s3.objects.keys()]).toEqual(["keep.txt"]);
  });

  test("delete refuses the bucket root", async () => {
    const { provider } = setup();
    await expect(provider.delete("")).rejects.toThrow("Refusing to delete every object");
  });

  test("createContainer writes a marker, except for the root", async () => {
    const { s3, provider } = setup();
    await provider.createContainer("dir/sub");
    expect(s3.objects.has("dir/sub/")).toBe(true);
    await provider.createContainer("");
    expect(s3.objects.size).toBe(1);
  });

  test("joinKey joins with /", () => {
    expect(setup().provider.joinKey("dir/", "/a.txt")).toBe("dir/a.txt");
  });
});

describe("S3IOProvider streams", () => {
  test("reads an object and ranges of it", async () => {
    const { s3, provider } = setup();
    s3.put("a.txt", "0123456789");
    const handle = await provider.getReadableStream("a.txt");
    expect(await text(handle.stream as ReadableStream<Item<PayloadKind.Js>>)).toBe("0123456789");
    expect(await text(await handle.readRange(2, 5))).toBe("234");
  });

  test("writes an object through Upload", async () => {
    const { s3, provider } = setup();
    const handle = await provider.getWritableStream("out.txt");
    const writer = (handle.stream as WritableStream<Item<PayloadKind.Js>>).getWriter();
    await writer.write({ payload: { kind: PayloadKind.Js, data: new TextEncoder().encode("hi") } });
    await writer.close();
    expect(s3.text("out.txt")).toBe("hi");
  });

  test("reports S3's part-size limits and writes multipart uploads", async () => {
    const { s3, provider } = setup();
    expect(provider.getPartSizeConstraints(1)).toBe(S3_PART_SIZE_CONSTRAINTS);
    async function* parts(): AsyncGenerator<Part<PayloadKind.Js>> {
      for (const [index, value] of ["ab", "cd"].entries()) {
        yield {
          index,
          offset: index * 2,
          kind: PayloadKind.Js,
          stream: new ReadableStream<Item<PayloadKind.Js>>({
            start(controller) {
              controller.enqueue({
                payload: { kind: PayloadKind.Js, data: new TextEncoder().encode(value) },
              });
              controller.close();
            },
          }),
          complete: async () => {},
        };
      }
    }
    const writer = provider.getMultipartWriter("big.bin", 2);
    await writer.write(parts());
    expect(s3.text("big.bin")).toBe("abcd");
  });
});

describe("S3IOProvider direct transfers", () => {
  test("only providers of the same bucket and connection are eligible", () => {
    const s3 = createFakeS3();
    const provider = new S3IOProvider({ bucket: "bucket", region: "eu-west-1" }, s3.client);
    expect(
      provider.canDirectTransfer(
        new S3IOProvider({ bucket: "bucket", region: "eu-west-1" }, s3.client),
      ),
    ).toBe(true);
    expect(
      provider.canDirectTransfer(
        new S3IOProvider({ bucket: "other", region: "eu-west-1" }, s3.client),
      ),
    ).toBe(false);
    expect(provider.canDirectTransfer({} as never)).toBe(false);
    expect(provider.supportsRecursiveDirectTransfer).toBe(false);
  });

  test("directCopy copies server-side and directMove also deletes the source", async () => {
    const { s3, provider } = setup();
    s3.put("a b.txt", "x");
    await provider.directCopy("a b.txt", "copy.txt");
    expect(s3.text("copy.txt")).toBe("x");
    await provider.directMove("copy.txt", "moved.txt");
    expect(s3.objects.has("copy.txt")).toBe(false);
    expect(s3.text("moved.txt")).toBe("x");
  });

  test("dispose destroys the client", async () => {
    const { s3, provider } = setup();
    let destroyed = false;
    s3.client.destroy = () => {
      destroyed = true;
    };
    await provider[Symbol.asyncDispose]();
    expect(destroyed).toBe(true);
  });

  test("creates its own client from the config", () => {
    expect(new S3IOProvider({ bucket: "bucket", region: "us-east-1" }).bucket).toBe("bucket");
  });
});
