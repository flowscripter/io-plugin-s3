import { describe, expect, test } from "bun:test";
import { type Item, PayloadKind } from "@flowscripter/pluggable-io-framework-api";
import { bytesOf } from "../../src/util/bytesOf.ts";

describe("bytesOf", () => {
  test("concatenates every item's bytes", async () => {
    const stream = new ReadableStream<Item<PayloadKind.Js>>({
      start(controller) {
        for (const text of ["ab", "c"]) {
          controller.enqueue({
            payload: { kind: PayloadKind.Js, data: new TextEncoder().encode(text) },
          });
        }
        controller.close();
      },
    });
    expect(new TextDecoder().decode(await bytesOf(stream))).toBe("abc");
  });
});
