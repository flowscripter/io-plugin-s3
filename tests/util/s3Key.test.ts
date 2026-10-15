import { describe, expect, test } from "bun:test";
import {
  containerPrefix,
  isSafeRelativePath,
  joinS3Key,
  normalizeS3Key,
} from "../../src/util/s3Key.ts";

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

  test("normalizeS3Key handles very long runs of slashes in linear time", () => {
    const start = performance.now();
    expect(normalizeS3Key(`${"/".repeat(200_000)}a${"/".repeat(200_000)}`)).toBe("a");
    expect(normalizeS3Key(`${"/".repeat(200_000)}x/y${"/".repeat(200_000)}b`)).toBe(
      `x/y${"/".repeat(200_000)}b`,
    );
    expect(normalizeS3Key("/".repeat(200_000))).toBe("");
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("isSafeRelativePath accepts normal and nested paths", () => {
    expect(isSafeRelativePath("a.txt")).toBe(true);
    expect(isSafeRelativePath("a/b/c.txt")).toBe(true);
    expect(isSafeRelativePath("a/..b/.c/d..e")).toBe(true);
  });

  test("isSafeRelativePath rejects dot segments, backslashes and NUL", () => {
    for (const path of ["..", "../a", "a/../b", "a/..", ".", "./a", "a/./b", "a\\b", "a\0b"]) {
      expect(isSafeRelativePath(path)).toBe(false);
    }
  });
});
