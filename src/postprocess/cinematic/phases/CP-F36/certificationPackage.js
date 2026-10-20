import { canonicalJson, hashCanonicalJson } from "../CP-F01/referenceHash.js";
import { isBundlePath, isSha256 } from "../CP-F01/referenceValidation.js";

export async function verifyCertificationPackage(manifest, inventory, artifacts) {
  const issues = [];
  let packageSha256 = null;
  try {
    if (!Array.isArray(inventory) || !inventory.length) throw new Error("An independent inventory of actual package files is required");
    const normalized = inventory.map(({ path, sha256, byteLength }) => ({ path, sha256, byteLength })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
    if (normalized.some((file) => !isBundlePath(file.path) || !isSha256(file.sha256) || !Number.isSafeInteger(file.byteLength) || file.byteLength < 1) || new Set(normalized.map(({ path }) => path.toLowerCase())).size !== normalized.length) throw new Error("Invalid or duplicate actual package files");
    packageSha256 = await hashCanonicalJson(normalized);
    if (packageSha256 !== manifest.packageSha256 || canonicalJson(normalized) !== canonicalJson(manifest.packageFiles)) throw new Error("Package changed or the submitted file list silently omits sources");
    for (const source of normalized) {
      const matches = [...artifacts.assetsById.values()].filter((asset) => asset.role === "source" && asset.path === source.path);
      if (matches.length !== 1 || matches[0].sha256 !== source.sha256 || matches[0].byteLength !== source.byteLength || !artifacts.bytesById.has(matches[0].id)) throw new Error(`Missing verified source bytes: ${source.path}`);
    }
  } catch (error) { issues.push({ code: "PACKAGE_IDENTITY_BLOCKED", path: "packageFiles", message: error.message }); }
  return { passed: issues.length === 0, packageSha256, issues };
}
