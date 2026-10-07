import { describe, expect, test } from "bun:test";
import { s3PropertySchema } from "../../src/schema/s3PropertySchema.ts";

describe("s3PropertySchema", () => {
  test("accepts etag, storage class and tags", () => {
    const value = { etag: '"e"', storageClass: "STANDARD", tags: { a: "b" } };
    expect(s3PropertySchema.parse(value)).toEqual(value);
  });
});
