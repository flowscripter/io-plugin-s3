import { describe, expect, test } from "bun:test";
import { toS3ProviderInputs } from "../../src/location/toS3ProviderInputs.ts";

describe("toS3ProviderInputs", () => {
  test("filename gives an entry target joined with /", () => {
    expect(toS3ProviderInputs({ bucket: "b", path: "/raw/", filename: "a.mov" })).toEqual({
      config: { bucket: "b" },
      target: { kind: "entry", key: "raw/a.mov" },
    });
  });

  test("pattern gives a pattern target", () => {
    expect(toS3ProviderInputs({ bucket: "b", path: "raw/", pattern: "*.mov" })).toEqual({
      config: { bucket: "b" },
      target: { kind: "pattern", containerKey: "raw", pattern: "*.mov" },
    });
  });

  test("neither gives a container target", () => {
    expect(toS3ProviderInputs({ bucket: "b", path: "" })).toEqual({
      config: { bucket: "b" },
      target: { kind: "container", key: "" },
    });
  });
});
