import { sha256Bytes, canonicalJson } from "../CP-F01/referenceHash.js";
import { isBundlePath, isSha256 } from "../CP-F01/referenceValidation.js";
import { decodeEvidenceJson, sameIdentifierSet, isText } from "./certificationData.js";
import { compareExactCaptures } from "./compareExactCaptures.js";

export async function verifyCertificationHandover(manifest, artifacts, readPortedAsset) {
  const issues = [];
  let rollbackComparison = null;
  let engineAfterSha256 = null;
  const portedFiles = [];
  try {
    for (const field of ["rolloutGuideId", "debugGuideId", "apiGuideId"]) {
      const asset = artifacts.assetsById.get(manifest.handover?.[field]);
      if (asset?.role !== "documentation" || !artifacts.bytesById.has(asset.id)) throw new Error(`Missing hashed handover document: ${field}`);
    }
    const rollbackId = manifest.handover?.rollbackEvidenceId;
    if (artifacts.assetsById.get(rollbackId)?.role !== "rollback-evidence") throw new Error("Real rollback evidence is required");
    const rollback = decodeEvidenceJson(artifacts.bytesById.get(rollbackId), "rollback");
    if (rollback.stage !== manifest.stage || rollback.packageSha256 !== manifest.packageSha256 || rollback.provenance !== "measured" || rollback.mocked !== false || rollback.route !== "legacy" || rollback.safeMode !== true || rollback.presentationCount !== 1 || rollback.host !== (manifest.stage === "future" ? "future-engine" : "isolated-bench")) throw new Error("Rollback was not measured on the required host with single legacy presentation");
    const baseline = artifacts.assetsById.get(rollback.baselineCaptureId);
    const restored = artifacts.assetsById.get(rollback.restoredCaptureId);
    if (!baseline || !restored || baseline.id === restored.id || [baseline, restored].some((asset) => asset.role !== "candidate-capture" || asset.provenance !== "measured")) throw new Error("Separate real baseline and restored buffers are required");
    if (canonicalJson(baseline.capture) !== canonicalJson(restored.capture)) throw new Error("Rollback buffer representations differ");
    rollbackComparison = compareExactCaptures(artifacts.bytesById.get(baseline.id), artifacts.bytesById.get(restored.id), baseline.capture);
    if (!rollbackComparison.passed) throw new Error("Rollback failed exact legacy byte comparison");
    if (manifest.stage === "future") {
      const portId = manifest.handover?.portManifestId;
      if (artifacts.assetsById.get(portId)?.role !== "port-manifest") throw new Error("Exact ported file manifest is missing");
      const port = decodeEvidenceJson(artifacts.bytesById.get(portId), "port manifest");
      if (port.packageSha256 !== manifest.packageSha256 || !isSha256(port.engineBeforeSha256) || !isSha256(port.engineAfterSha256) || !isText(port.snapshotId) || port.featureGateReversible !== true || port.anchorsReaudited !== true || typeof readPortedAsset !== "function") throw new Error("Snapshot, reaudited anchors, reversible gate and real engine reader are required");
      if (!sameIdentifierSet(port.files?.map(({ sourcePath }) => sourcePath), manifest.packageFiles.map(({ path }) => path))) throw new Error("Ported file inventory differs from the certified isolated package");
      const destinations = new Set();
      for (const entry of port.files) {
        const source = manifest.packageFiles.find(({ path }) => path === entry.sourcePath);
        if (!isBundlePath(entry.targetPath) || destinations.has(entry.targetPath.toLowerCase()) || entry.sourceSha256 !== source.sha256 || !isSha256(entry.targetSha256) || !Number.isSafeInteger(entry.targetByteLength) || entry.targetByteLength < 1 || entry.targetByteLength > 134217728) throw new Error("Unsafe, duplicate or unbound ported file");
        destinations.add(entry.targetPath.toLowerCase());
        if (entry.targetSha256 !== entry.sourceSha256 && !isText(entry.reviewedChange)) throw new Error("Changed port bytes require an explicit reviewed adapter/import change");
        const bytes = await readPortedAsset(entry.targetPath, { expectedBytes: entry.targetByteLength, maxBytes: 134217728 });
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.targetByteLength || await sha256Bytes(bytes) !== entry.targetSha256) throw new Error(`Ported engine bytes changed: ${entry.targetPath}`);
        portedFiles.push({ ...entry });
      }
      engineAfterSha256 = port.engineAfterSha256;
    }
  } catch (error) { issues.push({ code: "HANDOVER_BLOCKED", path: "handover", message: error.message }); }
  return { passed: issues.length === 0, rollbackComparison, portedFiles, engineAfterSha256, issues };
}
