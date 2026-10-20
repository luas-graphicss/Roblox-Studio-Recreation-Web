const PUBLIC_FOLDER_PREFIX = "public/";

export function publicAssetUrlCandidates(publicRelativePath) {
  const cleanPath = String(publicRelativePath || "").replace(/^\/+/, "");
  if (!cleanPath) return [];
  return ["./" + cleanPath, "./" + PUBLIC_FOLDER_PREFIX + cleanPath];
}

async function fetchFirstUsableCandidate(publicRelativePath, decodeResponse) {
  const candidates = publicAssetUrlCandidates(publicRelativePath);
  if (candidates.length === 0) throw new Error("publicAsset: empty path");
  const failures = [];
  for (const url of candidates) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        failures.push(url + " -> HTTP " + response.status);
        continue;
      }
      return await decodeResponse(response);
    } catch (error) {
      failures.push(url + " -> " + ((error && error.message) || error));
    }
  }
  throw new Error("publicAsset: could not load " + publicRelativePath + " (" + failures.join("; ") + ")");
}

export function fetchPublicJson(publicRelativePath) {
  return fetchFirstUsableCandidate(publicRelativePath, (response) => response.json());
}

export function fetchPublicArrayBuffer(publicRelativePath) {
  return fetchFirstUsableCandidate(publicRelativePath, (response) => response.arrayBuffer());
}
