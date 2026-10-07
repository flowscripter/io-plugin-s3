import { describe, expect, test } from "bun:test";
import { createS3Client } from "../../src/util/createS3Client.ts";

describe("createS3Client", () => {
  test("uses static credentials and path-style addressing for a custom endpoint", async () => {
    const client = createS3Client({
      bucket: "b",
      endpoint: "http://localhost:9000",
      accessKeyId: "id",
      secretAccessKey: "secret",
    });
    expect(client.config.forcePathStyle).toBe(true);
    expect(await client.config.region()).toBe("us-east-1");
    expect((await client.config.credentials()).accessKeyId).toBe("id");
    client.destroy();
  });

  test("leaves region and credentials to the default chain otherwise", async () => {
    const client = createS3Client({ bucket: "b", region: "eu-west-1" });
    expect(client.config.forcePathStyle).toBe(false);
    expect(await client.config.region()).toBe("eu-west-1");
    client.destroy();
  });
});
