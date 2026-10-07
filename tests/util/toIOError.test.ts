import { describe, expect, test } from "bun:test";
import { PermanentIOError, TransientIOError } from "@flowscripter/pluggable-io-framework-api";
import { isNotFound, statusOf, toIOError } from "../../src/util/toIOError.ts";

function sdkError(status?: number, extra: object = {}) {
  return Object.assign(new Error("boom"), {
    name: "Err",
    $metadata: { httpStatusCode: status },
    ...extra,
  });
}

describe("toIOError", () => {
  test("no response, timeouts, throttling, server errors and retryable errors are transient", () => {
    for (const error of [
      new Error("socket hang up"),
      sdkError(408),
      sdkError(429),
      sdkError(503),
      sdkError(400, { $retryable: {} }),
    ]) {
      expect(toIOError(error, "GetObject x")).toBeInstanceOf(TransientIOError);
    }
  });

  test("other client errors are permanent and keep the cause", () => {
    const error = sdkError(403);
    const converted = toIOError(error, "GetObject x");
    expect(converted).toBeInstanceOf(PermanentIOError);
    expect(converted.message).toBe("GetObject x failed: boom");
    expect(converted.cause).toBe(error);
  });

  test("already classified errors pass through", () => {
    const error = new PermanentIOError("p");
    expect(toIOError(error, "x")).toBe(error);
    expect(toIOError("plain", "x").message).toBe("x failed: plain");
  });
});

describe("statusOf and isNotFound", () => {
  test("read the SDK metadata and error names", () => {
    expect(statusOf(sdkError(404))).toBe(404);
    expect(statusOf(undefined)).toBeUndefined();
    expect(isNotFound(sdkError(404))).toBe(true);
    expect(isNotFound(Object.assign(new Error("x"), { name: "NoSuchKey" }))).toBe(true);
    expect(isNotFound(sdkError(500))).toBe(false);
  });
});
