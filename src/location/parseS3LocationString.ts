/**
 * Converts `s3://bucket/key` into `{ bucket, path }`. Region, endpoint and
 * credentials only come from the structured location form.
 */
export function parseS3LocationString(location: string): { bucket: string; path: string } {
  const match = /^s3:\/\/([^/]+)\/?(.*)$/i.exec(location);
  if (!match) {
    throw new Error(`Not an s3:// location: ${location}`);
  }
  return { bucket: match[1] as string, path: decodeURIComponent(match[2] as string) };
}
