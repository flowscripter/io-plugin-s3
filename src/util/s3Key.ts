/** Removes leading and trailing `/` - object keys are not paths. */
export function normalizeS3Key(key: string): string {
  let start = 0;
  let end = key.length;
  while (start < end && key[start] === "/") start++;
  while (end > start && key[end - 1] === "/") end--;
  return key.slice(start, end);
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
