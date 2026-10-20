export const MAX_AI_ENDPOINT_LENGTH = 512;

export const ALLOWED_AI_ENDPOINT_HOSTNAMES = Object.freeze([
  "api.openai.com",
  "api.anthropic.com",
]);

const CREDENTIAL_HOSTNAMES = new Set(ALLOWED_AI_ENDPOINT_HOSTNAMES);


const ALLOWED_LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const ALLOWED_LOOPBACK_PORT = "11434";
const ALLOWED_LOOPBACK_PATHNAMES = new Set(["/api/chat", "/api/generate"]);

function isLoopbackHostname(hostname) {
  return ALLOWED_LOOPBACK_HOSTNAMES.has(hostname);
}

function isAllowedLoopbackEndpoint(parsedUrl) {
  if (!isLoopbackHostname(parsedUrl.hostname)) return false;
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return false;
  if (parsedUrl.port !== ALLOWED_LOOPBACK_PORT) return false;
  return ALLOWED_LOOPBACK_PATHNAMES.has(parsedUrl.pathname);
}

function parseEndpointUrl(candidateUrl) {
  const rawUrl = String(candidateUrl == null ? "" : candidateUrl).trim();
  if (!rawUrl || rawUrl.length > MAX_AI_ENDPOINT_LENGTH) return null;
  try {
    return new URL(rawUrl);
  } catch (_) {
    return null;
  }
}

export function isLoopbackAiEndpoint(candidateUrl) {
  const parsedUrl = parseEndpointUrl(candidateUrl);
  return !!parsedUrl && isLoopbackHostname(parsedUrl.hostname);
}

export function isAllowedAiEndpoint(candidateUrl) {
  const parsedUrl = parseEndpointUrl(candidateUrl);
  if (!parsedUrl) return false;
  if (isLoopbackHostname(parsedUrl.hostname)) return isAllowedLoopbackEndpoint(parsedUrl);
  if (parsedUrl.protocol !== "https:") return false;
  return CREDENTIAL_HOSTNAMES.has(parsedUrl.hostname);
}



export function mayAttachCredential(endpointUrl) {
  const parsedUrl = parseEndpointUrl(endpointUrl);
  if (!parsedUrl) return false;
  if (parsedUrl.protocol !== "https:") return false;
  return CREDENTIAL_HOSTNAMES.has(parsedUrl.hostname);
}


export function isAcceptableAiEndpointSetting(value) {
  if (typeof value !== "string") return false;
  if (value.length > MAX_AI_ENDPOINT_LENGTH) return false;
  const trimmedValue = value.trim();
  if (!trimmedValue) return true;
  return isAllowedAiEndpoint(trimmedValue);
}

export function describeAllowedAiEndpoints() {
  const loopbackExamples = [...ALLOWED_LOOPBACK_HOSTNAMES]
    .map((hostname) => "http://" + hostname + ":" + ALLOWED_LOOPBACK_PORT + "/api/chat")
    .join(", ");
  return ALLOWED_AI_ENDPOINT_HOSTNAMES.join(", ") + ", " + loopbackExamples;
}
