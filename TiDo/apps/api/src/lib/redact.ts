// Long opaque strings in a URL are treated as secrets (invite, reset and session tokens are 43
// characters; UUIDs, at 36, stay readable), so a token that reaches a URL stays out of the logs.
export const redactUrl = (url: string) => url.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]');
