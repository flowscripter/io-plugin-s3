import { describe, expect, test } from "bun:test";
import { s3ConfigSchema } from "../../src/schema/s3ConfigSchema.ts";

describe("s3ConfigSchema", () => {
  test("requires a bucket and marks secrets", () => {
    expect(s3ConfigSchema.safeParse({}).success).toBe(false);
    expect(s3ConfigSchema.parse({ bucket: "b" })).toEqual({ bucket: "b" });
    expect(s3ConfigSchema.shape.secretAccessKey.meta()).toEqual({ secret: true });
    expect(s3ConfigSchema.shape.sessionToken.meta()).toEqual({ secret: true });
  });
});
