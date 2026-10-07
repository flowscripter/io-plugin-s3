import { describe, expect, test } from "bun:test";
import { containerPrefix, joinS3Key, normalizeS3Key } from "../../src/util/s3Key.ts";

describe("s3Key", () => {
  test("normalizeS3Key strips leading and trailing slashes", () => {
    expect(normalizeS3Key("/a/b/")).toBe("a/b");
  });

  test("joinS3Key skips empty segments", () => {
    expect(joinS3Key("", "/a/", "b")).toBe("a/b");
  });

  test("containerPrefix ends with / except for the root", () => {
    expect(containerPrefix("a")).toBe("a/");
    expect(containerPrefix("/")).toBe("");
  });
});
