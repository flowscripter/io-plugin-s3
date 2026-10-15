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

  test("rejects a missing bucket and keeps extra slashes in the path", () => {
    expect(() => parseS3LocationString("s3://")).toThrow("Not an s3:// location");
    expect(() => parseS3LocationString("s3:///key")).toThrow("Not an s3:// location");
    expect(parseS3LocationString("s3://b//x")).toEqual({ bucket: "b", path: "/x" });
  });

  test("handles very long inputs in linear time", () => {
    const start = performance.now();
    expect(parseS3LocationString(`s3://${"..".repeat(200_000)}`).path).toBe("");
    expect(parseS3LocationString(`s3://b/${"/".repeat(200_000)}`).path.length).toBe(200_000);
    expect(() => parseS3LocationString(`s3:/${"/".repeat(200_000)}`)).toThrow();
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
