import { S3Client } from "@aws-sdk/client-s3";

interface StoredObject {
  data: Uint8Array;
  contentType?: string;
  storageClass?: string;
  metadata?: Record<string, string>;
  tags: { Key: string; Value: string }[];
  lastModified: Date;
}

interface MultipartUpload {
  key: string;
  parts: Map<number, { data: Uint8Array; etag: string }>;
}

export interface FakeS3 {
  readonly client: S3Client;
  readonly objects: Map<string, StoredObject>;
  readonly uploads: Map<string, MultipartUpload>;
  readonly calls: string[];
  /** Makes the next call of the named command fail with an error of the given status. */
  failNext(command: string, status?: number): void;
  put(key: string, text: string): void;
  text(key: string): string | undefined;
}

function sdkError(name: string, status: number): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
}

async function toBytes(body: unknown): Promise<Uint8Array> {
  if (body === undefined) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * A real `S3Client` (so its config resolves as usual) whose `send` is served
 * by an in-memory bucket, for the commands the provider uses.
 */
export function createFakeS3(pageSize = 1000): FakeS3 {
  const client = new S3Client({
    region: "us-east-1",
    endpoint: "http://s3.test",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });
  const objects = new Map<string, StoredObject>();
  const uploads = new Map<string, MultipartUpload>();
  const calls: string[] = [];
  const failures = new Map<string, number>();
  let nextId = 0;

  const notFound = () => sdkError("NotFound", 404);

  const handlers: Record<string, (input: any) => Promise<unknown>> = {
    async HeadObjectCommand(input) {
      const object = objects.get(input.Key);
      if (!object) throw notFound();
      return {
        ContentLength: object.data.byteLength,
        LastModified: object.lastModified,
        ContentType: object.contentType,
        ETag: `"${input.Key}"`,
        StorageClass: object.storageClass,
        Metadata: object.metadata,
      };
    },
    async GetObjectTaggingCommand(input) {
      return { TagSet: objects.get(input.Key)?.tags ?? [] };
    },
    async PutObjectTaggingCommand(input) {
      const object = objects.get(input.Key);
      if (!object) throw notFound();
      object.tags = input.Tagging.TagSet;
      return {};
    },
    async GetObjectCommand(input) {
      const object = objects.get(input.Key);
      if (!object) throw sdkError("NoSuchKey", 404);
      let data = object.data;
      if (input.Range) {
        const [, from, to] = /bytes=(\d+)-(\d*)/.exec(input.Range) ?? [];
        const start = Number(from);
        if (start >= data.byteLength) throw sdkError("InvalidRange", 416);
        const end = to === "" ? data.byteLength : Math.min(Number(to) + 1, data.byteLength);
        data = data.subarray(start, end);
      }
      return { Body: { transformToWebStream: () => new Response(Buffer.from(data)).body } };
    },
    async PutObjectCommand(input) {
      objects.set(input.Key, {
        data: await toBytes(input.Body),
        contentType: input.ContentType,
        tags: [],
        lastModified: new Date(),
      });
      return { ETag: `"${input.Key}"` };
    },
    async CopyObjectCommand(input) {
      const sourceKey = decodeURIComponent(input.CopySource.slice(input.Bucket.length + 1));
      const source = objects.get(sourceKey);
      if (!source) throw sdkError("NoSuchKey", 404);
      objects.set(input.Key, {
        ...source,
        contentType: input.ContentType ?? source.contentType,
        storageClass: input.StorageClass ?? source.storageClass,
        metadata: input.Metadata ?? source.metadata,
        tags: [...source.tags],
        lastModified: new Date(),
      });
      return {};
    },
    async DeleteObjectCommand(input) {
      objects.delete(input.Key);
      return {};
    },
    async DeleteObjectsCommand(input) {
      for (const { Key } of input.Delete.Objects) objects.delete(Key);
      return {};
    },
    async ListObjectsV2Command(input) {
      const prefix: string = input.Prefix ?? "";
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const contents: string[] = [];
      const prefixes = new Set<string>();
      for (const key of keys) {
        const rest = key.slice(prefix.length);
        const slash = input.Delimiter ? rest.indexOf(input.Delimiter) : -1;
        if (slash !== -1 && slash < rest.length - 1) {
          prefixes.add(prefix + rest.slice(0, slash + 1));
        } else {
          contents.push(key);
        }
      }
      const start = Number(input.ContinuationToken ?? 0);
      const limit = Math.min(input.MaxKeys ?? pageSize, pageSize);
      const page = contents.slice(start, start + limit);
      const truncated = start + limit < contents.length;
      return {
        Contents: page.map((Key) => ({
          Key,
          Size: objects.get(Key)?.data.byteLength,
          LastModified: objects.get(Key)?.lastModified,
          ETag: `"${Key}"`,
          StorageClass: objects.get(Key)?.storageClass,
        })),
        CommonPrefixes: start === 0 ? [...prefixes].map((Prefix) => ({ Prefix })) : [],
        KeyCount: page.length + (start === 0 ? prefixes.size : 0),
        IsTruncated: truncated,
        NextContinuationToken: truncated ? String(start + limit) : undefined,
      };
    },
    async CreateMultipartUploadCommand(input) {
      nextId += 1;
      const id = `upload-${nextId}`;
      uploads.set(id, { key: input.Key, parts: new Map() });
      return { UploadId: id };
    },
    async UploadPartCommand(input) {
      const upload = uploads.get(input.UploadId);
      if (!upload) throw sdkError("NoSuchUpload", 404);
      const etag = `"${input.UploadId}-${input.PartNumber}"`;
      upload.parts.set(input.PartNumber, { data: await toBytes(input.Body), etag });
      return { ETag: etag };
    },
    async ListPartsCommand(input) {
      const upload = uploads.get(input.UploadId);
      if (!upload) throw sdkError("NoSuchUpload", 404);
      const numbers = [...upload.parts.keys()].sort((a, b) => a - b);
      const after = Number(input.PartNumberMarker ?? 0);
      const remaining = numbers.filter((n) => n > after);
      const page = remaining.slice(0, 1);
      return {
        Parts: page.map((PartNumber) => ({
          PartNumber,
          ETag: upload.parts.get(PartNumber)?.etag,
          Size: upload.parts.get(PartNumber)?.data.byteLength,
        })),
        IsTruncated: remaining.length > 1,
        NextPartNumberMarker: page.length ? String(page[0]) : undefined,
      };
    },
    async CompleteMultipartUploadCommand(input) {
      const upload = uploads.get(input.UploadId);
      if (!upload) throw sdkError("NoSuchUpload", 404);
      const data = Buffer.concat(
        input.MultipartUpload.Parts.map(
          (part: { PartNumber: number }) =>
            upload.parts.get(part.PartNumber)?.data ?? new Uint8Array(),
        ),
      );
      objects.set(upload.key, { data, tags: [], lastModified: new Date() });
      uploads.delete(input.UploadId);
      return {};
    },
    async AbortMultipartUploadCommand(input) {
      uploads.delete(input.UploadId);
      return {};
    },
  };

  client.send = (async (command: { constructor: { name: string }; input: unknown }) => {
    const name = command.constructor.name;
    calls.push(name);
    const status = failures.get(name);
    if (status !== undefined) {
      failures.delete(name);
      throw sdkError(`${name}Failed`, status);
    }
    const handler = handlers[name];
    if (!handler) throw new Error(`fake S3 does not handle ${name}`);
    return handler(command.input);
  }) as S3Client["send"];

  return {
    client,
    objects,
    uploads,
    calls,
    failNext(command: string, status = 500) {
      failures.set(command, status);
    },
    put(key: string, text: string) {
      objects.set(key, {
        data: new TextEncoder().encode(text),
        tags: [],
        lastModified: new Date(0),
      });
    },
    text(key: string) {
      const object = objects.get(key);
      return object === undefined ? undefined : new TextDecoder().decode(object.data);
    },
  };
}
