import { canonicalJson, sha256Bytes } from "../CP-F01/referenceHash.js";
import { sameIdentifierSet } from "./certificationData.js";
import { compareExactCaptures } from "./compareExactCaptures.js";

const settingsFields = ["plugins", "renderSize", "outputSize", "cvars", "postVolumes", "camera", "seed", "timestepSeconds", "antiAliasing", "jitter", "exposureWarmupFrames", "temporalWarmupFrames", "outputTransform"];
const captureFields = ["width", "height", "format", "encoding", "origin", "sizeDomain", "profileId", "sceneId"];

export async function verifyCertificationSequences(manifest, referenceManifest, artifacts, readReferenceAsset) {
  const issues = [];
  const comparisons = [];
  const expectedRuns = referenceManifest?.captureRuns ?? [];
  const actualRuns = Array.isArray(manifest.captureRuns) ? manifest.captureRuns : [];
  const runMap = new Map(actualRuns.map((run) => [run.id, run]));
  const referenceAssets = new Map((referenceManifest?.assets ?? []).map((asset) => [asset.id, asset]));
  const requireCondition = (condition, message) => { if (!condition) throw new Error(message); };
  if (!expectedRuns.length || !sameIdentifierSet(actualRuns.map(({ id }) => id), expectedRuns.map(({ id }) => id))) issues.push({ code: "INCOMPLETE_SEQUENCES", path: "captureRuns", message: "The full reference capture run set is mandatory" });
  for (const referenceRun of expectedRuns) {
    try {
      const candidateRun = runMap.get(referenceRun.id);
      requireCondition(candidateRun?.profileId === referenceRun.profileId && candidateRun.sceneId === referenceRun.sceneId, "Missing or mismatched profile/scene run");
      requireCondition(candidateRun.backend === "gpu" && candidateRun.provenance === "measured" && candidateRun.host === (manifest.stage === "future" ? "future-engine" : "isolated-bench"), "Synthetic captures or a simulated Future host cannot certify a run");
      for (const field of settingsFields) requireCondition(canonicalJson(candidateRun.settings?.[field]) === canonicalJson(referenceRun.frozen?.[field]?.value), `Frozen setting changed: ${field}`);
      requireCondition(Array.isArray(candidateRun.frames) && candidateRun.frames.length >= 2 && candidateRun.frames.length === referenceRun.frames.length, "Every reference frame is required; a still is not a sequence");
      for (const [position, referenceFrame] of referenceRun.frames.entries()) {
        const candidateFrame = candidateRun.frames[position];
        for (const field of ["index", "timeSeconds", "jitterPixels", "events"]) requireCondition(canonicalJson(candidateFrame[field]) === canonicalJson(referenceFrame[field]), `Frame ${position} changed ${field}`);
        requireCondition(sameIdentifierSet(Object.keys(candidateFrame.captures ?? {}), Object.keys(referenceFrame.captures)), "Capture slot coverage differs");
        for (const [slot, referenceId] of Object.entries(referenceFrame.captures)) {
          const referenceAsset = referenceAssets.get(referenceId);
          const candidateId = candidateFrame.captures[slot];
          const candidateAsset = artifacts.assetsById.get(candidateId);
          requireCondition(referenceAsset?.role === "capture" && candidateAsset?.role === "candidate-capture" && candidateAsset.provenance === "measured", "Real reference and candidate buffers are required");
          const descriptor = referenceAsset.capture;
          requireCondition(candidateAsset.referenceAssetId === referenceId, "Wrong reference/candidate pairing");
          requireCondition(candidateAsset.capture?.runId === referenceRun.id && candidateAsset.capture?.frameIndex === referenceFrame.index && candidateAsset.capture?.slot === slot, "Capture stamp mismatch");
          for (const field of captureFields) requireCondition(candidateAsset.capture[field] === descriptor[field], `Capture representation changed: ${field}`);
          const received = await readReferenceAsset(referenceAsset.path, { expectedBytes: referenceAsset.byteLength, maxBytes: 134217728 });
          requireCondition(received instanceof Uint8Array && received.byteLength === referenceAsset.byteLength, "Missing reference bytes");
          const referenceBytes = new Uint8Array(received);
          requireCondition(await sha256Bytes(referenceBytes) === referenceAsset.sha256, "Reference bytes changed after CP-F01 verification");
          const result = compareExactCaptures(referenceBytes, artifacts.bytesById.get(candidateId), descriptor);
          comparisons.push({ runId: referenceRun.id, profileId: referenceRun.profileId, frameIndex: referenceFrame.index, slot, referenceAssetId: referenceId, candidateAssetId: candidateId, ...result });
          if (!result.passed) issues.push({ code: "NONEXACT_CAPTURE", path: `${referenceRun.id}/${referenceFrame.index}/${slot}`, message: `${result.differingPixels} different pixels, ${result.differingBytes} different bytes, ${result.nonFiniteSamples} nonfinite samples` });
        }
      }
    } catch (error) { issues.push({ code: "SEQUENCE_BLOCKED", path: referenceRun.id, message: error.message }); }
  }
  return { passed: issues.length === 0 && comparisons.length > 0, comparisons, issues };
}
