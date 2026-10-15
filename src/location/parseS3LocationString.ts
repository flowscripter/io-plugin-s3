/**
 * Converts `s3://bucket/key` into `{ bucket, path }`. Region, endpoint and
 * credentials only come from the structured location form.
 */
export function parseS3LocationString(location: string): { bucket: string; path: string } {
  const scheme = "s3://";
  if (location.slice(0, scheme.length).toLowerCase() !== scheme) {
    throw new Error(`Not an s3:// location: ${location}`);
  }
  const rest = location.slice(scheme.length);
  const slash = rest.indexOf("/");
  const bucket = slash === -1 ? rest : rest.slice(0, slash);
  if (bucket === "") {
    throw new Error(`Not an s3:// location: ${location}`);
  }
  const path = slash === -1 ? "" : rest.slice(slash + 1);
  return { bucket, path: decodeURIComponent(path) };
}
