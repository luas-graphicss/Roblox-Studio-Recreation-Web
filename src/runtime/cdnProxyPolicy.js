export const MAX_PROXY_PREFIX_LENGTH = 2048;

const BLOCKED_PROXY_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

const PRIVATE_ADDRESS_PATTERN = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

const URL_PLACEHOLDER = "{url}";

export function isAllowedProxyPrefix(proxyPrefix) {
  if (typeof proxyPrefix !== "string") return false;
  if (!proxyPrefix || proxyPrefix.length > MAX_PROXY_PREFIX_LENGTH) return false;

  let parsedUrl = null;
  try {
    parsedUrl = new URL(proxyPrefix.split(URL_PLACEHOLDER)[0]);
  } catch (_) {
    return false;
  }
  if (parsedUrl.protocol !== "https:") return false;
  if (BLOCKED_PROXY_HOSTNAMES.has(parsedUrl.hostname)) return false;
  if (PRIVATE_ADDRESS_PATTERN.test(parsedUrl.hostname)) return false;
  return true;
}


export function filterAllowedProxyPrefixes(candidatePrefixes) {
  if (!Array.isArray(candidatePrefixes)) return [];
  return candidatePrefixes.filter(isAllowedProxyPrefix);
}


export function filterAllowedProxyPrefixesOrUndefined(candidatePrefixes) {
  const allowedPrefixes = filterAllowedProxyPrefixes(candidatePrefixes);
  return allowedPrefixes.length ? allowedPrefixes : undefined;
}
