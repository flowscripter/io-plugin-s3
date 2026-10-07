import { describe, expect, test } from "bun:test";
import { parseS3LocationString } from "../../src/location/parseS3LocationString.ts";

describe("parseS3LocationString", () => {
  test("maps the host to the bucket and the rest to the path", () => {
    expect(parseS3LocationString("s3://media/raw/a%20b.mov")).toEqual({
      bucket: "media",
      path: "raw/a b.mov",
    });
    expect(parseS3LocationString("S3://media")).toEqual({ bucket: "media", path: "" });
  });

  test("rejects anything that is not an s3:// location", () => {
    expect(() => parseS3LocationString("https://media/a")).toThrow("Not an s3:// location");
  });
});
