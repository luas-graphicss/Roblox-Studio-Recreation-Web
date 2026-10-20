import { REFERENCE_SCHEMA_VERSION, BUILD_FIELDS } from "./referenceConstants.js";
import { createIssueCollector, indexById, readFacts, isText, isSha256, isBundlePath, isRecord } from "./referenceValidation.js";
import { validateReferenceInventory } from "./referenceInventory.js";
import { validateCaptureRuns } from "./referenceCapture.js";

export function validateReferenceManifest(manifest) {
  const collector = createIssueCollector();
  if (!isRecord(manifest)) return { valid: false, issues: [{ code: "MISSING_MANIFEST", path: "manifest", message: "A reference manifest is required" }], counts: {} };
  collector.require(manifest.schemaVersion === REFERENCE_SCHEMA_VERSION, "SCHEMA_MISMATCH", "schemaVersion", "Unsupported reference schema");
  collector.require(manifest.target?.engine === "Unreal Engine" && manifest.target?.version === "5.9", "WRONG_REFERENCE_TARGET", "target", "UE5.8 cannot silently replace UE5.9");
  collector.require(isText(manifest.bundleId) && isText(manifest.preparedBy) && isText(manifest.capturedBy), "MISSING_BUNDLE_IDENTITY", "bundleId", "Bundle, author and capture operator must be identified");
  collector.require(["reference", "synthetic"].includes(manifest.provenance), "MISSING_PROVENANCE", "provenance", "Provenance must be explicit");
  const assets = indexById(manifest.assets, "assets", collector);
  const sources = indexById(manifest.sources, "sources", collector);
  const paths = new Set();
  for (const [id, asset] of assets) {
    collector.require(isBundlePath(asset.path) && !paths.has(asset.path.toLowerCase()), "UNSAFE_ASSET_PATH", `assets.${id}.path`, "Use unique, relative, case-insensitive-safe bundle paths without traversal or URLs");
    paths.add(String(asset.path).toLowerCase());
    collector.require(isSha256(asset.sha256) && Number.isSafeInteger(asset.byteLength) && asset.byteLength > 0, "INVALID_ASSET_DIGEST", `assets.${id}`, "SHA-256 and positive exact byte length are required");
    collector.require(["reference", "synthetic"].includes(asset.provenance) && isText(asset.role), "INVALID_ASSET_PROVENANCE", `assets.${id}`, "Asset role and provenance must be explicit");
  }
  for (const [id, source] of sources) collector.require(assets.has(source.assetId), "MISSING_SOURCE_ASSET", `sources.${id}`, "Source material must be included and independently hashed");
  const build = readFacts(manifest.build?.facts, BUILD_FIELDS, "build.facts", sources, collector);
  collector.require(build.version === "5.9" && ["buildId", "branch", "platform", "licenseAuthorization"].every((field) => isText(build[field])) && Number.isSafeInteger(build.changelist) && build.changelist > 0, "UNVERIFIED_BUILD", "build", "An identified authorized UE5.9 build with a positive changelist is required");
  collector.require(assets.get(manifest.build?.identityAssetId)?.role === "build-identity", "MISSING_BUILD_IDENTITY", "build.identityAssetId", "A build identity artifact must exist");
  collector.require(assets.get(manifest.inventory?.exportAssetId)?.role === "inventory-export", "MISSING_INDEPENDENT_INVENTORY", "inventory.exportAssetId", "An independent inventory export must exist");
  const inventory = validateReferenceInventory(manifest.inventory, sources, collector);
  for (const [kind, entries] of Object.entries(inventory)) for (const [id, entry] of entries) for (const field of ["positiveTest", "negativeTest"]) {
    if (kind === "profiles") continue;
    collector.require(assets.get(entry.values[field])?.role === "test-evidence", "MISSING_TEST_EVIDENCE", `inventory.${kind}.${id}.${field}`, "Positive/negative cases must resolve to a test evidence artifact");
  }
  const capture = validateCaptureRuns(manifest, inventory, sources, assets, collector);
  return { valid: collector.issues.length === 0, issues: collector.issues, counts: { properties: inventory.properties.size, passes: inventory.passes.size, profiles: inventory.profiles.size, assets: assets.size, ...capture } };
}
