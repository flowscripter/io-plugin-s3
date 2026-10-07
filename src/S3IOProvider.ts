import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  PutObjectTaggingCommand,
  type S3Client,
  type StorageClass,
} from "@aws-sdk/client-s3";
import {
  type EntryProperties,
  type EntryPropertyChanges,
  type IOProvider,
  type PartSizeConstraints,
  PayloadKind,
  PermanentIOError,
  type RangeReadable,
  type ResumeToken,
  type StreamHandle,
} from "@flowscripter/pluggable-io-framework-api";
import type { S3Config } from "./schema/s3ConfigSchema.ts";
import { s3SettablePropertySchema } from "./schema/s3SettablePropertySchema.ts";
import { createMultipartWriter, type MultipartWriter } from "./stream/createMultipartWriter.ts";
import { createReadableHandle } from "./stream/createReadableHandle.ts";
import { createWritableHandle } from "./stream/createWritableHandle.ts";
import { createS3Client } from "./util/createS3Client.ts";
import { containerPrefix, joinS3Key, normalizeS3Key } from "./util/s3Key.ts";
import { isNotFound, toIOError } from "./util/toIOError.ts";

const MIB = 1024 * 1024;

/** S3's multipart limits: 5 MiB to 5 GiB per part, at most 10000 parts. */
export const S3_PART_SIZE_CONSTRAINTS: PartSizeConstraints = {
  minPartSize: 5 * MIB,
  maxPartSize: 5 * 1024 * MIB,
  maxParts: 10000,
  defaultPartSize: 8 * MIB,
};

const DELETE_BATCH_SIZE = 1000;

function containerProperties(): EntryProperties {
  return { size: undefined, lastModified: undefined, isContainer: true, properties: {} };
}

/**
 * Amazon S3 (and S3-compatible) source/sink provider for one bucket. Keys
 * are object keys; a container is a key prefix, so `dir` holds every object
 * whose key starts with `dir/`, and the empty key is the whole bucket.
 */
export class S3IOProvider implements IOProvider<PayloadKind.Js> {
  public readonly kind = PayloadKind.Js;
  public readonly supportsRecursiveDirectTransfer = false;
  readonly #config: S3Config;
  readonly #client: S3Client;

  public constructor(config: S3Config, client: S3Client = createS3Client(config)) {
    this.#config = config;
    this.#client = client;
  }

  public get bucket(): string {
    return this.#config.bucket;
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    this.#client.destroy();
  }

  public joinKey(containerKey: string, name: string): string {
    return joinS3Key(containerKey, name);
  }

  /**
   * An object's properties, including its tags. A key with no object of its
   * own but with objects under `key/` is a container.
   */
  public async getProperties(key: string): Promise<EntryProperties> {
    const objectKey = normalizeS3Key(key);
    if (objectKey === "") {
      return containerProperties();
    }
    try {
      const head = await this.#client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      const tagging = await this.#client.send(
        new GetObjectTaggingCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return {
        size: head.ContentLength,
        lastModified: head.LastModified,
        isContainer: false,
        contentType: head.ContentType,
        properties: {
          etag: head.ETag,
          storageClass: head.StorageClass ?? "STANDARD",
          tags: Object.fromEntries((tagging.TagSet ?? []).map((tag) => [tag.Key, tag.Value])),
        },
      };
    } catch (error) {
      if (!isNotFound(error)) {
        throw toIOError(error, `HeadObject s3://${this.bucket}/${objectKey}`);
      }
    }
    const listing = await this.#call(`ListObjectsV2 s3://${this.bucket}/${objectKey}`, () =>
      this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: containerPrefix(objectKey),
          MaxKeys: 1,
        }),
      ),
    );
    if ((listing.KeyCount ?? 0) > 0) {
      return containerProperties();
    }
    throw new PermanentIOError(`s3://${this.bucket}/${objectKey} does not exist`);
  }

  /**
   * Lists the entries under a container. Without `recursive`, only direct
   * children are listed and sub-prefixes are reported as containers. `regex`
   * is matched against each entry's path relative to the container.
   */
  public list(
    key: string,
    options?: { recursive?: boolean; regex?: RegExp },
  ): AsyncIterable<{ path: string; properties: EntryProperties }> {
    const prefix = containerPrefix(key);
    const recursive = options?.recursive ?? false;
    const regex = options?.regex;
    const call = this.#call.bind(this);
    const client = this.#client;
    const bucket = this.bucket;
    async function* generate(): AsyncGenerator<{ path: string; properties: EntryProperties }> {
      let token: string | undefined;
      do {
        const page = await call(`ListObjectsV2 s3://${bucket}/${prefix}`, () =>
          client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: prefix,
              Delimiter: recursive ? undefined : "/",
              ContinuationToken: token,
            }),
          ),
        );
        for (const common of page.CommonPrefixes ?? []) {
          const path = normalizeS3Key((common.Prefix ?? "").slice(prefix.length));
          if (path !== "" && (!regex || regex.test(path))) {
            yield { path, properties: containerProperties() };
          }
        }
        for (const object of page.Contents ?? []) {
          const relative = (object.Key ?? "").slice(prefix.length);
          const path = normalizeS3Key(relative);
          if (path === "" || (regex && !regex.test(path))) continue;
          if (relative.endsWith("/")) {
            yield { path, properties: containerProperties() };
            continue;
          }
          yield {
            path,
            properties: {
              size: object.Size,
              lastModified: object.LastModified,
              isContainer: false,
              properties: { etag: object.ETag, storageClass: object.StorageClass ?? "STANDARD" },
            },
          };
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
    }
    return generate();
  }

  /**
   * Changes an object's content type and storage class by copying it onto
   * itself (S3 cannot change them in place), and replaces its tags. S3 sets
   * `lastModified` itself, so it cannot be changed.
   */
  public async setProperties(key: string, changes: EntryPropertyChanges): Promise<void> {
    if (changes.lastModified !== undefined) {
      throw new PermanentIOError("S3 does not allow lastModified to be set");
    }
    const properties = s3SettablePropertySchema.parse(changes.properties ?? {});
    const objectKey = normalizeS3Key(key);
    const target = `s3://${this.bucket}/${objectKey}`;
    if (changes.contentType !== undefined || properties.storageClass !== undefined) {
      const head = await this.#call(`HeadObject ${target}`, () =>
        this.#client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey })),
      );
      await this.#call(`CopyObject ${target}`, () =>
        this.#client.send(
          new CopyObjectCommand({
            Bucket: this.bucket,
            Key: objectKey,
            CopySource: `${this.bucket}/${encodeURIComponent(objectKey)}`,
            MetadataDirective: "REPLACE",
            Metadata: head.Metadata,
            ContentType: changes.contentType ?? head.ContentType,
            StorageClass: (properties.storageClass ?? head.StorageClass) as
              | StorageClass
              | undefined,
          }),
        ),
      );
    }
    const tags = properties.tags;
    if (tags !== undefined) {
      await this.#call(`PutObjectTagging ${target}`, () =>
        this.#client.send(
          new PutObjectTaggingCommand({
            Bucket: this.bucket,
            Key: objectKey,
            Tagging: {
              TagSet: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
            },
          }),
        ),
      );
    }
  }

  /**
   * Deletes the object at `key` and every object under `key/`. Deleting the
   * whole bucket (the empty key) is refused.
   */
  public async delete(key: string): Promise<void> {
    const objectKey = normalizeS3Key(key);
    if (objectKey === "") {
      throw new PermanentIOError(`Refusing to delete every object in bucket ${this.bucket}`);
    }
    await this.#call(`DeleteObject s3://${this.bucket}/${objectKey}`, () =>
      this.#client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey })),
    );
    let batch: string[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      await this.#call(`DeleteObjects s3://${this.bucket}/${objectKey}/`, () =>
        this.#client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        ),
      );
      batch = [];
    };
    const prefix = containerPrefix(objectKey);
    for await (const entry of this.list(objectKey, { recursive: true })) {
      batch.push(`${prefix}${entry.path}${entry.properties.isContainer ? "/" : ""}`);
      if (batch.length === DELETE_BATCH_SIZE) await flush();
    }
    await flush();
  }

  /** Creates the zero-byte `key/` marker object S3 consoles show as a folder. */
  public async createContainer(key: string): Promise<void> {
    const marker = containerPrefix(key);
    if (marker === "") return;
    await this.#call(`PutObject s3://${this.bucket}/${marker}`, () =>
      this.#client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: marker, Body: new Uint8Array() }),
      ),
    );
  }

  public getReadableStream(
    key: string,
  ): Promise<StreamHandle<PayloadKind.Js> & RangeReadable<PayloadKind.Js>> {
    return createReadableHandle(this.#client, this.bucket, normalizeS3Key(key));
  }

  public async getWritableStream(key: string): Promise<StreamHandle<PayloadKind.Js>> {
    return createWritableHandle(this.#client, this.bucket, normalizeS3Key(key));
  }

  public getPartSizeConstraints(_totalSize: number): PartSizeConstraints {
    return S3_PART_SIZE_CONSTRAINTS;
  }

  /**
   * An S3 multipart upload. Passing a token from a previous writer's
   * `resumeToken()` continues that upload.
   */
  public getMultipartWriter(
    key: string,
    _partSize: number,
    opts?: { resume?: ResumeToken },
  ): MultipartWriter {
    return createMultipartWriter(this.#client, this.bucket, normalizeS3Key(key), opts?.resume);
  }

  /** True for another provider of the same bucket reached the same way. */
  public canDirectTransfer(other: IOProvider): boolean {
    if (!(other instanceof S3IOProvider)) {
      return false;
    }
    const a = this.#config;
    const b = other.#config;
    return (
      a.bucket === b.bucket &&
      a.region === b.region &&
      a.endpoint === b.endpoint &&
      a.accessKeyId === b.accessKeyId
    );
  }

  /** Server-side `CopyObject` within the bucket (up to S3's 5 GiB copy limit). */
  public async directCopy(sourceKey: string, destKey: string): Promise<void> {
    const source = normalizeS3Key(sourceKey);
    const dest = normalizeS3Key(destKey);
    await this.#call(`CopyObject s3://${this.bucket}/${source}`, () =>
      this.#client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: dest,
          CopySource: `${this.bucket}/${encodeURIComponent(source)}`,
        }),
      ),
    );
  }

  /** Server-side copy followed by deleting the source. */
  public async directMove(sourceKey: string, destKey: string): Promise<void> {
    await this.directCopy(sourceKey, destKey);
    await this.delete(sourceKey);
  }

  async #call<T>(action: string, request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      throw toIOError(error, action);
    }
  }
}
