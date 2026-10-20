import { isBundlePath, isSha256 } from "../CP-F01/referenceValidation.js";
import { sha256Bytes } from "../CP-F01/referenceHash.js";
import { isText } from "./certificationData.js";

export async function verifyCertificationArtifacts(assets, readAsset, limits = {}) {
  const ceilings = { maxAssets: 20000, maxAssetBytes: 134217728, maxTotalBytes: 1073741824, ...limits };
  const issues = [];
  const bytesById = new Map();
  const assetsById = new Map();
  const verified = [];
  const reject = (code, path, message) => issues.push({ code, path, message });
  if (!Array.isArray(assets) || !assets.length || typeof readAsset !== "function") return { passed: false, bytesById, assetsById, verified, issues: [{ code: "MISSING_ARTIFACTS", path: "assets", message: "Nonempty artifacts and an independent byte reader are required" }] };
  if (!Object.values(ceilings).every((value) => Number.isSafeInteger(value) && value > 0)) throw new TypeError("Positive integrity ceilings are required");
  const paths = new Set();
  let totalBytes = 0;
  for (const asset of assets) {
    if (!asset || !isText(asset.id) || assetsById.has(asset.id) || !isBundlePath(asset.path) || paths.has(asset.path.toLowerCase()) || !isSha256(asset.sha256) || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1 || !isText(asset.role) || !["measured", "synthetic"].includes(asset.provenance)) {
      reject("INVALID_ARTIFACT", asset?.id ?? "assets", "Unique ids, safe paths, SHA-256, nonempty byte lengths, role and provenance are required");
      continue;
    }
    assetsById.set(asset.id, asset);
    paths.add(asset.path.toLowerCase());
    totalBytes += asset.byteLength;
    if (asset.byteLength > ceilings.maxAssetBytes) reject("ARTIFACT_LIMIT", asset.path, "Artifact exceeds the frozen ceiling");
  }
  if (assets.length > ceilings.maxAssets || totalBytes > ceilings.maxTotalBytes || !Number.isSafeInteger(totalBytes)) reject("ARTIFACT_LIMIT", "assets", "Count or total size exceeds the ceiling");
  if (issues.length) return { passed: false, bytesById, assetsById, verified, issues };
  for (const asset of assets) {
    try {
      const received = await readAsset(asset.path, { expectedBytes: asset.byteLength, maxBytes: ceilings.maxAssetBytes });
      if (!(received instanceof Uint8Array) || received.byteLength !== asset.byteLength) throw new Error("Missing artifact or byte length mismatch");
      const bytes = new Uint8Array(received);
      if (await sha256Bytes(bytes) !== asset.sha256) throw new Error("SHA-256 mismatch");
      bytesById.set(asset.id, bytes);
      verified.push({ id: asset.id, path: asset.path, sha256: asset.sha256, byteLength: bytes.byteLength });
    } catch (error) { reject("ARTIFACT_INTEGRITY_FAILED", asset.path, error.message); }
  }
  return { passed: issues.length === 0, bytesById, assetsById, verified, issues };
}
