import { describe, expect, test } from "bun:test";
import { PayloadKind } from "@flowscripter/pluggable-io-framework-api";
import { S3IOProvider } from "../src/S3IOProvider.ts";
import { s3IOProviderFactory } from "../src/S3IOProviderFactory.ts";

describe("s3IOProviderFactory", () => {
  test("declares the s3 protocol and the js payload kind", () => {
    expect(s3IOProviderFactory.protocol).toBe("s3");
    expect(s3IOProviderFactory.kind).toBe(PayloadKind.Js);
  });

  test("turns a location string into config and a target", () => {
    const location = s3IOProviderFactory.locationSchema.parse({
      ...(s3IOProviderFactory.parseLocationString("s3://media/raw/") as object),
      filename: "a.mov",
      region: "eu-west-1",
    });
    expect(s3IOProviderFactory.toProviderInputs(location)).toEqual({
      config: { bucket: "media", region: "eu-west-1" },
      target: { kind: "entry", key: "raw/a.mov" },
    });
  });

  test("creates an S3IOProvider", async () => {
    const provider = await s3IOProviderFactory.createProvider(
      { bucket: "media", region: "us-east-1" },
      { resolver: { createProviderForLocation: () => Promise.reject(new Error("not used")) } },
    );
    expect(provider).toBeInstanceOf(S3IOProvider);
    await provider[Symbol.asyncDispose]();
  });
});
