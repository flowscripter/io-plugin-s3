import { describe, expect, test } from "bun:test";
import { s3LocationSchema } from "../../src/schema/s3LocationSchema.ts";

describe("s3LocationSchema", () => {
  test("defaults path to the bucket root and rejects filename with pattern", () => {
    expect(s3LocationSchema.parse({ bucket: "b" })).toEqual({ bucket: "b", path: "" });
    expect(s3LocationSchema.safeParse({ bucket: "b", filename: "a", pattern: "*" }).success).toBe(
      false,
    );
  });
});
