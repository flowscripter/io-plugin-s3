import { PermanentIOError, TransientIOError } from "@flowscripter/pluggable-io-framework-api";

interface SdkError {
  readonly name?: string;
  readonly message?: string;
  readonly $retryable?: unknown;
  readonly $metadata?: { readonly httpStatusCode?: number };
}

/** The HTTP status of an AWS SDK error, when it got a response. */
export function statusOf(error: unknown): number | undefined {
  return (error as SdkError | undefined)?.$metadata?.httpStatusCode;
}

export function isNotFound(error: unknown): boolean {
  const name = (error as SdkError | undefined)?.name;
  return statusOf(error) === 404 || name === "NotFound" || name === "NoSuchKey";
}

/**
 * Classifies an AWS SDK error: no response, timeouts, throttling, server
 * errors and errors the SDK marks retryable are transient; the rest are
 * permanent.
 */
export function toIOError(error: unknown, action: string): Error {
  if (error instanceof TransientIOError || error instanceof PermanentIOError) {
    return error;
  }
  const status = statusOf(error);
  const message = `${action} failed: ${(error as SdkError | undefined)?.message ?? String(error)}`;
  const transient =
    status === undefined ||
    status === 408 ||
    status === 429 ||
    status >= 500 ||
    (error as SdkError).$retryable !== undefined;
  return transient
    ? new TransientIOError(message, { cause: error })
    : new PermanentIOError(message, { cause: error });
}
