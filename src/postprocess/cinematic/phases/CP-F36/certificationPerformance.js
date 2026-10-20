import { canonicalJson } from "../CP-F01/referenceHash.js";
import { decodeEvidenceJson, sameIdentifierSet, isText } from "./certificationData.js";

function percentile(values, probability) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(probability * ordered.length) - 1)];
}

export function verifyCertificationPerformance(manifest, referenceManifest, artifacts, policy) {
  const issues = [];
  const measurements = [];
  try {
    if (policy?.frozen !== true || policy.owner !== "CP-F35" || !Array.isArray(policy.profiles) || !policy.profiles.length) throw new Error("An independently supplied frozen CP-F35 hardware and budget policy is required");
    const asset = artifacts.assetsById.get(manifest.performanceEvidenceId);
    if (asset?.role !== "performance" || asset.provenance !== "measured") throw new Error("Measured performance artifact bytes are required");
    const evidence = decodeEvidenceJson(artifacts.bytesById.get(asset.id), "performance");
    if (evidence.packageSha256 !== manifest.packageSha256 || evidence.stage !== manifest.stage || evidence.provenance !== "measured") throw new Error("Wrong package, stage or performance provenance");
    const profiles = referenceManifest?.inventory?.profiles?.map(({ id }) => id) ?? [];
    if (!profiles.length || !sameIdentifierSet(policy.profiles.map(({ profileId }) => profileId), profiles) || !sameIdentifierSet(evidence.profiles?.map(({ profileId }) => profileId), profiles)) throw new Error("All reference quality profiles need performance coverage");
    for (const budget of policy.profiles) {
      const record = evidence.profiles.find(({ profileId }) => profileId === budget.profileId);
      if (canonicalJson(record.hardware) !== canonicalJson(budget.hardware) || !["gpu", "cpu", "driver", "browser", "os", "rhi"].every((field) => isText(record.hardware?.[field]))) throw new Error(`${budget.profileId}: incomplete or different target hardware`);
      if (record.visible !== true || record.headless !== false || record.softwareRenderer !== false || record.timingKind !== "gpu-timer-query" || record.disjoint !== false) throw new Error(`${budget.profileId}: headless, software, disjoint or CPU-only timing cannot establish GPU performance`);
      if (!Number.isSafeInteger(record.warmupFrames) || record.warmupFrames < 120 || !Array.isArray(record.frames) || record.frames.length < 600 || record.frames.length > 100000) throw new Error(`${budget.profileId}: 120 warmup and 600 visible sample frames are required`);
      if (canonicalJson(record.outputSize) !== canonicalJson(budget.outputSize)) throw new Error("Performance output dimensions differ from the frozen policy");
      const fields = ["gpuMs", "cpuSchedulingMs", "allocatedBytes", "draws", "passes", "compilations"];
      if (record.frames.some((frame, index) => !Number.isSafeInteger(frame.index) || frame.index < 0 || (index > 0 && frame.index !== record.frames[index - 1].index + 1) || fields.some((field) => typeof frame[field] !== "number" || !Number.isFinite(frame[field]) || frame[field] < 0))) throw new Error("Invalid, missing or noncontiguous performance samples");
      const result = { profileId: budget.profileId, sampleFrames: record.frames.length, gpuP50Ms: percentile(record.frames.map(({ gpuMs }) => gpuMs), 0.5), gpuP95Ms: percentile(record.frames.map(({ gpuMs }) => gpuMs), 0.95), gpuP99Ms: percentile(record.frames.map(({ gpuMs }) => gpuMs), 0.99), cpuP95Ms: percentile(record.frames.map(({ cpuSchedulingMs }) => cpuSchedulingMs), 0.95), peakAllocatedBytes: record.frames.reduce((peak, { allocatedBytes }) => Math.max(peak, allocatedBytes), 0) };
      for (const field of ["gpuP95Ms", "gpuP99Ms", "cpuP95Ms", "peakAllocatedBytes"]) if (!Number.isFinite(budget.ceilings?.[field]) || budget.ceilings[field] <= 0 || result[field] > budget.ceilings[field]) throw new Error(`${budget.profileId}: ${field} exceeds or lacks a frozen ceiling`);
      if (budget.hdr === true && (record.hdrDisplay?.verified !== true || !isText(record.hdrDisplay.measurementArtifactId) || !artifacts.bytesById.has(record.hdrDisplay.measurementArtifactId))) throw new Error("HDR needs actual display measurement evidence");
      measurements.push(result);
    }
  } catch (error) { issues.push({ code: "PERFORMANCE_BLOCKED", path: "performance", message: error.message }); }
  return { passed: issues.length === 0 && measurements.length > 0, measurements, issues };
}
