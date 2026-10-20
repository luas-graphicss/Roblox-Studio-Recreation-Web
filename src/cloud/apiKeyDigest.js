const DIGEST_ALGORITHM = "SHA-256";

function requireSubtleCrypto() {
  const subtle = typeof crypto !== "undefined" && crypto ? crypto.subtle : null;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new Error("WebCrypto digest is not available in this environment.");
  }
  return subtle;
}

export function isTokenDigestSupported() {
  try {
    requireSubtleCrypto();
    return true;
  } catch (_) {
    return false;
  }
}

export async function createTokenDigest(rawToken) {
  const subtle = requireSubtleCrypto();
  const encodedToken = new TextEncoder().encode(String(rawToken == null ? "" : rawToken));
  const digestBuffer = await subtle.digest(DIGEST_ALGORITHM, encodedToken);
  return Array.from(new Uint8Array(digestBuffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function matchesTokenDigest(rawToken, storedDigest) {
  const expectedDigest = String(storedDigest == null ? "" : storedDigest);
  if (!expectedDigest) return false;
  const candidateDigest = await createTokenDigest(rawToken);
  if (candidateDigest.length !== expectedDigest.length) return false;
  let difference = 0;
  for (let index = 0; index < candidateDigest.length; index += 1) {
    difference |= candidateDigest.charCodeAt(index) ^ expectedDigest.charCodeAt(index);
  }
  return difference === 0;
}
