import { canonicalJson, copyEvidenceState, sha256, float32LittleEndian } from "./canonicalEvidence.js";
import { validatePixels } from "./diagnosticValidation.js";

const encoder = new TextEncoder();

function encodeBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function createEvidenceBundle({ snapshots, graph, comparison, environment, sourceManifest = [] }) {
  if (!Array.isArray(snapshots) || snapshots.length < 1 || snapshots.length > 32) throw new Error("Evidence requires 1..32 captured buffers");
  if (!environment || !environment.backend || !environment.browser || !environment.fixtureProvenance) throw new Error("Capture environment and fixture provenance are required");
  const entries = [];
  const files = [];
  async function add(path, bytes, mediaType) {
    const hash = await sha256(bytes);
    entries.push({ path, sha256: hash, bytes: bytes.byteLength, mediaType });
    files.push({ path, base64: encodeBase64(bytes) });
  }
  const frozenGraph = encoder.encode(canonicalJson(graph));
  const frozenComparison = encoder.encode(canonicalJson(comparison));
  const frozenEnvironment = copyEvidenceState(environment);
  const frozenSourceManifest = copyEvidenceState(sourceManifest);
  const prepared = snapshots.map(({ metadata, pixels }, index) => {
    validatePixels(pixels, metadata.width, metadata.height);
    return {
      pixels: float32LittleEndian(pixels),
      metadata: encoder.encode(canonicalJson({ ...metadata, pixelFile: `capture-${index}.rgba32f-le`, representation: "RGBA float32 little-endian, bottom-left, decoded metric domain" }))
    };
  });
  for (let index = 0; index < prepared.length; index += 1) {
    await add(`capture-${index}.rgba32f-le`, prepared[index].pixels, "application/octet-stream");
    await add(`capture-${index}.json`, prepared[index].metadata, "application/json");
  }
  await add("graph.json", frozenGraph, "application/json");
  await add("comparison.json", frozenComparison, "application/json");
  const manifest = copyEvidenceState({ schema: "CP-F30.evidence.v1", phase: "CP-F30", environment: frozenEnvironment, sourceManifest: frozenSourceManifest, entries, uiIncluded: false, reviewed: false, referenceCertified: false, performanceCertified: false });
  const manifestSha256 = await sha256(encoder.encode(canonicalJson(manifest)));
  return { manifest, manifestSha256, files };
}

export async function verifyEvidenceBundle(bundle) {
  const problems = [];
  try {
    if (bundle?.manifest?.schema !== "CP-F30.evidence.v1" || !Array.isArray(bundle.files) || !bundle.files.length || !Array.isArray(bundle.manifest.entries) || !bundle.manifest.entries.length) throw new Error("Missing evidence files or manifest");
    const actualManifestHash = await sha256(encoder.encode(canonicalJson(bundle.manifest)));
    if (bundle.manifestSha256 !== actualManifestHash) problems.push("Manifest hash mismatch");
    const fileMap = new Map();
    for (const file of bundle.files) {
      if (!/^[a-zA-Z0-9._-]+$/.test(file.path) || fileMap.has(file.path)) throw new Error("Unsafe or duplicate evidence path");
      fileMap.set(file.path, file);
    }
    const entryPaths = new Set();
    for (const entry of bundle.manifest.entries) {
      if (entryPaths.has(entry.path)) throw new Error("Duplicate manifest entry");
      entryPaths.add(entry.path);
      const file = fileMap.get(entry.path);
      if (!file) { problems.push(`Missing file: ${entry.path}`); continue; }
      const bytes = decodeBase64(file.base64);
      if (!bytes.length || bytes.length !== entry.bytes || await sha256(bytes) !== entry.sha256) problems.push(`Byte integrity failed: ${entry.path}`);
    }
    if (fileMap.size !== entryPaths.size) problems.push("Unmanifested evidence files");
    if (!entryPaths.has("capture-0.rgba32f-le") || !entryPaths.has("capture-0.json") || !entryPaths.has("graph.json") || !entryPaths.has("comparison.json")) problems.push("Required capture evidence is missing");
  } catch (error) { problems.push(error.message); }
  return { status: problems.length ? "fail" : "pass", problems, scope: "byte integrity only; not reference equivalence", referenceCertified: false };
}
