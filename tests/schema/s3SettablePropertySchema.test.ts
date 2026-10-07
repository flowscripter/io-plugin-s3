import { describe, expect, test } from "bun:test";
import { s3SettablePropertySchema } from "../../src/schema/s3SettablePropertySchema.ts";

describe("s3SettablePropertySchema", () => {
  test("accepts storage class and string tags", () => {
    expect(s3SettablePropertySchema.parse({ storageClass: "GLACIER", tags: { a: "b" } })).toEqual({
      storageClass: "GLACIER",
      tags: { a: "b" },
    });
    expect(s3SettablePropertySchema.safeParse({ tags: { a: 1 } }).success).toBe(false);
  });
});
