const TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const REJECTION_CEILING = 256 - (256 % TOKEN_ALPHABET.length);

function requireCryptoApi() {
  const cryptoApi = typeof crypto !== "undefined" ? crypto : null;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("No cryptographically secure random source is available.");
  }
  return cryptoApi;
}

export function isSecureRandomAvailable() {
  try {
    requireCryptoApi();
    return true;
  } catch (_) {
    return false;
  }
}

export function getSecureRandomBytes(byteCount) {
  const cryptoApi = requireCryptoApi();
  const randomBytes = new Uint8Array(Math.max(0, byteCount | 0));
  cryptoApi.getRandomValues(randomBytes);
  return randomBytes;
}

export function generateSecureToken(prefix, length) {
  const requestedLength = Math.max(1, length | 0);
  let token = "";
  while (token.length < requestedLength) {
    const randomBytes = getSecureRandomBytes(requestedLength - token.length);
    for (const byte of randomBytes) {
      if (byte >= REJECTION_CEILING) continue;
      token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
      if (token.length === requestedLength) break;
    }
  }
  return String(prefix == null ? "" : prefix) + token;
}

export function generateSecureUuid() {
  const cryptoApi = requireCryptoApi();
  if (typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();

  const randomBytes = getSecureRandomBytes(16);
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40;             
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80;                    
  const hex = Array.from(randomBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}
