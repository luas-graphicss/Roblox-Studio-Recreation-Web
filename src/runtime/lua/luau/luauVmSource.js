const WASM_GZ_URL = "assets/luau/luau-vm.wasm.gz";
const WASM_B64_CHUNK_PREFIX = "assets/luau/luau-vm.b64.";
const WASM_B64_CHUNK_COUNT = 11;
const GZIP_FIRST_BYTE = 0x1f;
const GZIP_SECOND_BYTE = 0x8b;
const BASE64_ALPHABET = /^[A-Za-z0-9+/=]+$/;

function isGzip(bytes) {
  return bytes.length >= 3 && bytes[0] === GZIP_FIRST_BYTE && bytes[1] === GZIP_SECOND_BYTE;
}


export function decodeBase64Gzip(base64Text) {
  if (typeof base64Text !== "string" || !base64Text) return null;
  const clean = base64Text.replace(/\s+/g, "");
  if (!clean || !BASE64_ALPHABET.test(clean)) return null;
  let binary;
  try {
    binary = atob(clean);
  } catch (_) {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return isGzip(bytes) ? bytes : null;
}

async function fetchGzipBinary(baseUrl) {
  const response = await fetch(baseUrl + WASM_GZ_URL).catch(() => null);
  if (!response || !response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return isGzip(bytes) ? bytes : null;
}

async function fetchBase64Chunks(baseUrl) {
  let base64Text = "";
  for (let index = 0; index < WASM_B64_CHUNK_COUNT; index++) {
    const chunkName = WASM_B64_CHUNK_PREFIX + String(index).padStart(2, "0");
    const response = await fetch(baseUrl + chunkName).catch(() => null);
    if (!response || !response.ok) return null;
    base64Text += (await response.text()).replace(/\s+/g, "");
  }
  return decodeBase64Gzip(base64Text);
}


async function importEmbeddedBase64() {
  try {
    const payload = await import("./luauVmPayload.js");
    return decodeBase64Gzip(payload ? payload.LUAU_VM_B64 : null);
  } catch (_) {
    return null;
  }
}

export async function loadLuauVmGzipBytes(baseUrl = "") {
  if (typeof fetch === "function") {
    const fromBinary = await fetchGzipBinary(baseUrl);
    if (fromBinary) return fromBinary;
    const fromChunks = await fetchBase64Chunks(baseUrl);
    if (fromChunks) return fromChunks;
  }
  const fromEmbeddedPayload = await importEmbeddedBase64();
  if (fromEmbeddedPayload) return fromEmbeddedPayload;
  throw new Error(
    "payload da VM Luau indisponível (assets em assets/luau/ e payload embutido falharam)",
  );
}
