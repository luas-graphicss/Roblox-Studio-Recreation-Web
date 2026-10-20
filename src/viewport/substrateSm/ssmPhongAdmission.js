import { inspectSubstrateSmMaterialBoundary } from "./ssmMaterialBoundaryPolicy.js";
import { resolveSubstrateSmBackend } from "../../lighting/substrateSm/ssmBackendPolicyCore.js";
import { resolveSubstrateSmOwnership } from "../../lighting/substrateSm/ssmOwnershipCore.js";
import { inspectSubstrateSmPhongHost } from "./ssmPhongHostPolicy.js";
import { inspectSubstrateSmPhongMaterial } from "./ssmPhongMaterialPolicy.js";

export function resolveSubstrateSmPhongAdmission(mesh, input = {}) {
  const settings = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const host = inspectSubstrateSmPhongHost(mesh);
  const materialBoundary = inspectSubstrateSmMaterialBoundary({ material: mesh?.material, bsdfKind: settings.bsdfKind });
  const materialPath = settings.materialPath ?? host.materialPath ?? "phong";
  const pathMatches = materialPath === host.materialPath;
  const blendMode = settings.blendMode ?? host.material?.blendMode;
  const blendMatches = blendMode === host.material?.blendMode;
  const decision = resolveSubstrateSmBackend({
    ...settings,
    materialPath,
    blendMode,
    hostPathReady: settings.hostPathReady === true && host.allowed && materialBoundary.allowed && pathMatches && blendMatches,
  });
  if (decision.eligible) {
    const profile = decision.effectiveQuality ?? decision.proposedQuality;
    const recipe = settings.candidates?.[profile]?.recipe;
    const material = inspectSubstrateSmPhongMaterial({ material: mesh.material, materialPath, recipe });
    if (!material.supported) {
      return Object.freeze({
        ...decision,
        backend: "legacy",
        targetBackend: "legacy",
        state: "fallback",
        eligible: false,
        ready: false,
        applied: false,
        effectiveQuality: null,
        code: material.reason,
        field: "recipe",
        ownership: resolveSubstrateSmOwnership("legacy"),
        host,
        materialBoundary,
        pathMatches,
        blendMatches,
      });
    }
  }
  return Object.freeze({ ...decision, host, materialBoundary, pathMatches, blendMatches });
}
