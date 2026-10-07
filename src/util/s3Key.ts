/** Removes leading and trailing `/` - object keys are not paths. */
export function normalizeS3Key(key: string): string {
  return key.replace(/^\/+|\/+$/g, "");
}

/** Joins key segments with `/`, ignoring empty segments. */
export function joinS3Key(...segments: string[]): string {
  return segments
    .map(normalizeS3Key)
    .filter((segment) => segment !== "")
    .join("/");
}

/** The listing prefix for everything under a container key. */
export function containerPrefix(key: string): string {
  const normalized = normalizeS3Key(key);
  return normalized === "" ? "" : `${normalized}/`;
}
