import { CAPTURE_FORMATS } from "./referenceConstants.js";
import { sha256Bytes } from "./referenceHash.js";
import { verifySourcedFacts } from "./referenceFactsIntegrity.js";

function assertFiniteCapture(bytes, capture) {
  const format = CAPTURE_FORMATS[capture.format];
  if (!format?.floating) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.byteLength; offset += format.channelBytes) {
    const finite = format.channelBytes === 2 ? (view.getUint16(offset, true) & 0x7c00) !== 0x7c00 : Number.isFinite(view.getFloat32(offset, true));
    if (!finite) throw new Error(`Non-finite capture sample at byte ${offset}`);
  }
}

function parseJsonAsset(bytes, label) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error(`${label} is not valid UTF-8 JSON`); }
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && actual.every((item) => expected.includes(item));
}

export async function verifyAssetIntegrity(manifest, readAsset, { maxAssetBytes = 134217728, maxTotalBytes = 536870912, maxAssets = 10000 } = {}) {
  const issues = [];
  const retained = new Map();
  const assets = manifest.assets;
  if (typeof readAsset !== "function") return { passed: false, checkedAssets: 0, checkedBytes: 0, issues: [{ code: "MISSING_ASSET_READER", path: "assets", message: "No independent byte reader was supplied" }] };
  if (!Number.isSafeInteger(maxAssetBytes) || !Number.isSafeInteger(maxTotalBytes) || !Number.isSafeInteger(maxAssets) || Math.min(maxAssetBytes, maxTotalBytes, maxAssets) <= 0) throw new TypeError("Integrity limits must be positive safe integers");
  const totalBytes = assets.reduce((total, asset) => total + asset.byteLength, 0);
  if (assets.length > maxAssets || totalBytes > maxTotalBytes || !Number.isSafeInteger(totalBytes) || assets.some((asset) => asset.byteLength > maxAssetBytes)) return { passed: false, checkedAssets: 0, checkedBytes: 0, issues: [{ code: "BUNDLE_BUDGET_EXCEEDED", path: "assets", message: "The bundle exceeds explicit byte or asset limits before I/O" }] };
  let checkedAssets = 0;
  let checkedBytes = 0;
  for (const asset of assets) {
    try {
      const received = await readAsset(asset.path, { expectedBytes: asset.byteLength, maxBytes: maxAssetBytes });
      if (!(received instanceof Uint8Array) || received.byteLength !== asset.byteLength) throw new Error("Asset missing or byte length mismatch");
      const bytes = new Uint8Array(received);
      if (await sha256Bytes(bytes) !== asset.sha256) throw new Error("SHA-256 mismatch against the signed manifest");
      if (asset.role === "capture") assertFiniteCapture(bytes, asset.capture);
      if ([manifest.build.identityAssetId, manifest.inventory.exportAssetId, ...manifest.sources.map((source) => source.assetId)].includes(asset.id)) retained.set(asset.id, bytes);
      checkedAssets += 1;
      checkedBytes += bytes.byteLength;
    } catch (error) { issues.push({ code: "ASSET_INTEGRITY_FAILED", path: asset.path, message: error.message }); }
  }
  try {
    const identity = parseJsonAsset(retained.get(manifest.build.identityAssetId), "Build identity");
    const build = manifest.build.facts;
    if (identity.MajorVersion !== 5 || identity.MinorVersion !== 9 || identity.Changelist !== build.changelist.value || identity.BranchName !== build.branch.value) throw new Error("Actual Build.version bytes do not identify the declared UE5.9 build");
  } catch (error) { issues.push({ code: "BUILD_IDENTITY_MISMATCH", path: "build", message: error.message }); }
  try {
    const exported = parseJsonAsset(retained.get(manifest.inventory.exportAssetId), "Inventory export");
    if (exported.version !== "5.9" || exported.buildId !== manifest.build.facts.buildId.value) throw new Error("Inventory export belongs to a different build");
    for (const kind of ["properties", "passes", "profiles"]) {
      const expected = manifest.inventory[kind].map((entry) => entry.facts.originalPath.value);
      if (!sameSet(exported[kind], expected)) throw new Error(`The manifest omits or invents ${kind} from the independent export`);
    }
  } catch (error) { issues.push({ code: "INVENTORY_EXPORT_MISMATCH", path: "inventory", message: error.message }); }
  const sourceDocuments = new Map();
  for (const source of manifest.sources) {
    try { sourceDocuments.set(source.id, parseJsonAsset(retained.get(source.assetId), `Source ${source.id}`)); }
    catch (error) { issues.push({ code: "INVALID_SOURCE_EXPORT", path: source.id, message: error.message }); }
  }
  const facts = verifySourcedFacts(manifest, sourceDocuments);
  issues.push(...facts.issues);
  return { passed: issues.length === 0, checkedAssets, checkedBytes, checkedFacts: facts.checkedFacts, issues };
}
