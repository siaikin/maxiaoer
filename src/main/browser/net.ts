export function isNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /net::ERR_|Navigation timeout|ERR_TIMED_OUT|ERR_CONNECTION|ENOTFOUND|ECONNRESET|EAI_AGAIN|ECONNREFUSED|socket hang up|ERR_INTERNET|ERR_NAME_NOT_RESOLVED/i.test(message)
}
