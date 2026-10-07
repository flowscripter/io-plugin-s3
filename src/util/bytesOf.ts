import type { Item, PayloadKind } from "@flowscripter/pluggable-io-framework-api";

/** Reads a stream of js items into one buffer. */
export async function bytesOf(stream: ReadableStream<Item<PayloadKind.Js>>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value.payload.data);
  }
  return Buffer.concat(chunks);
}
