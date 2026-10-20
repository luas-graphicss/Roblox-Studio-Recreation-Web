import { getStageIndex } from "../../contracts/pipelineStages.js";

const formatBytes = Object.freeze({ rgba16f: 8, rgba8: 4, rg16f: 4, r16f: 2, r32f: 4, depth24: 4 });

export function buildDiagnosticGraph(passes, { inputs = ["sceneColor"], resources = {}, execution = [], colorWrites = {} } = {}) {
  if (!Array.isArray(passes)) throw new TypeError("Pass descriptors are required");
  const ordered = [...passes].sort((left, right) => getStageIndex(left.stage) - getStageIndex(right.stage) || left.order - right.order || left.id.localeCompare(right.id));
  const lifetimes = new Map(inputs.map((resource) => [resource, { resource, producer: "host", firstUse: 0, lastUse: 0, consumers: [] }]));
  const problems = [];
  const edges = [];
  const nodes = [];
  const identifiers = new Set();
  let currentColor = "sceneColor";
  let unknownColorLineage = false;
  if (!ordered.length) problems.push("Pipeline has no passes");
  ordered.forEach((pass, index) => {
    if (!pass.id || identifiers.has(pass.id)) problems.push(`Duplicate or missing pass identifier: ${pass.id}`);
    identifiers.add(pass.id);
    const observed = execution.find((entry) => entry.id === pass.id);
    const node = { id: pass.id, owner: pass.owner, stage: pass.stage, order: pass.order, index, status: observed?.status ?? "unmeasured", cpuSubmissionMs: Number.isFinite(observed?.cpuSubmissionMs) ? observed.cpuSubmissionMs : null, timingDomain: "CPU submission; not GPU execution", message: observed?.message ?? null };
    if (observed?.status === "failed") problems.push(`${pass.id}: ${observed.message ?? "execution failed"}`);
    nodes.push(node);
    for (const name of pass.reads ?? []) {
      const resolved = name === "$color" ? currentColor : name;
      const lifetime = resolved && lifetimes.get(resolved);
      if (!lifetime) { problems.push(`${pass.id}: missing producer for ${name}`); continue; }
      lifetime.lastUse = index;
      lifetime.consumers.push(pass.id);
      edges.push({ resource: resolved, from: lifetime.producer, to: pass.id });
      if (name === "$color" && unknownColorLineage) problems.push(`${pass.id}: current-color lineage is not declared`);
    }
    for (const resource of pass.writes ?? []) {
      if (lifetimes.has(resource)) problems.push(`Duplicate writer: ${resource}`);
      if (pass.reads?.includes(resource)) problems.push(`Read/write feedback: ${resource}`);
      lifetimes.set(resource, { resource, producer: pass.id, firstUse: index, lastUse: index, consumers: [] });
    }
    if (colorWrites[pass.id]) {
      if (!pass.writes?.includes(colorWrites[pass.id])) problems.push(`Color output is not declared by ${pass.id}`);
      currentColor = colorWrites[pass.id];
      unknownColorLineage = false;
    } else if (pass.transformsColor === true) {
      if (pass.writes?.length === 1) currentColor = pass.writes[0];
      else { currentColor = null; unknownColorLineage = true; }
    } else if (pass.transformsColor === undefined && pass.stage !== "prepare" && pass.writes?.length) unknownColorLineage = true;
  });
  const rows = [...lifetimes.values()].map((entry) => {
    const metadata = resources[entry.resource];
    const bytesPerPixel = formatBytes[metadata?.format];
    const estimatedBytes = bytesPerPixel && metadata?.width > 0 && metadata?.height > 0 ? metadata.width * metadata.height * bytesPerPixel : null;
    return { ...entry, format: metadata?.format ?? null, estimatedBytes, lifetimeDomain: "scheduled reads/writes; not allocation or disposal timing" };
  });
  const allSubmitted = ordered.length > 0 && nodes.every((node) => node.status === "submitted");
  return { status: problems.length ? "blocked" : allSubmitted ? "submitted" : "unmeasured", nodes, edges, lifetimes: rows, problems, allocationMeasured: false, gpuTimingMeasured: false };
}
