import {
  registerLocalLightFlag,
  isLocalLightFlagActive,
  resolveLocalLightFlag,
  setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
  LEGACY_SPECULAR_CALL,
  PARITY_F0_UNIFORM,
  PARITY_MIX_UNIFORM,
  PHONG_LIGHTING_CHUNK_NAME,
  rewritePhongLightingChunk,
} from "../lighting/llMaterialParityGlsl.js";
import {
  CORRECTED_PATH_ID,
  MATERIAL_PATHS,
  MATERIAL_PATH_IDS,
  PARITY_GATES,
  auditFeatureReach,
  evaluateParityVerdict,
  phongParityPlan,
} from "../lighting/llMaterialParityCore.js";
import { DIELECTRIC_F0, saturate } from "../lighting/llSpecularAlbedoCore.js";
import { isSubstrateSmShaderResponseOwned } from "./substrateSm/ssmShaderOwnership.js";

export const PHASE_ID = "LL-F8";
export const PARITY_FLAG_ID = "MaterialParity";
export const PARITY_PATCH_ID = "ll-f8-material-parity";

export const PARITY_ANCHOR = LEGACY_SPECULAR_CALL;


export const PARITY_PATCH_ORDER = 80;


const GGX_MATERIAL_PATH_IDS = Object.freeze(MATERIAL_PATH_IDS.filter((pathId) => pathId !== CORRECTED_PATH_ID));


const MATERIAL_PATHS_BY_PATCH_ID = Object.freeze({
  "ll-f2-falloff": MATERIAL_PATH_IDS,
  "ll-f4-source-shape": MATERIAL_PATH_IDS,
  "ll-f5-spot-cone": MATERIAL_PATH_IDS,
  "ll-f6-area-specular": GGX_MATERIAL_PATH_IDS,
  "ll-f8-material-parity": Object.freeze([CORRECTED_PATH_ID]),
});


registerLocalLightFlag({
  id: PARITY_FLAG_ID,
  phase: PHASE_ID,
  description:
    "material parity: the Phong pool answers direct light with the specular BRDF (GGX) of the Standard path",
  defaultsByTier: { fraco: false, medio: true, forte: true },
});





export function registerLocalLightMaterialParityPhase(options) {
  const settings = options && typeof options === "object" ? options : {};
  const registry = settings.registry;
  if (!registry || typeof registry.registerShaderPatch !== "function") {
    throw new Error("LL-F8: a local-light patch registry is required");
  }
  const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


  registry.registerUniform(PARITY_MIX_UNIFORM, 1);
  registry.registerUniform(PARITY_F0_UNIFORM, DIELECTRIC_F0);


  llQa.setTextureUnits(PHASE_ID, 0);

  let appliedShaderCount = 0;
  let lastRefusal = "";

  function recordRefusal(reason) {
    lastRefusal = reason;
    llQa.addError("LL-F8: " + reason, { phase: PHASE_ID, patch: PARITY_PATCH_ID });
    if (logger) logger.warn("[Luzes locais] LL-F8 recusou: " + reason);
  }


  function isPhaseActive(context) {
    const frame = context && typeof context === "object" ? context : {};
    if (isSubstrateSmShaderResponseOwned(frame.shader)) return false;
    if (!isLocalLightTechnology(frame.technology)) return false;
    if (isLocalLightBaselineFrozen(frame.tier)) return false;
    return isLocalLightFlagActive(PARITY_FLAG_ID, frame.tier);
  }

  registry.registerShaderPatch({
    id: PARITY_PATCH_ID,
    phase: PHASE_ID,
    anchor: PARITY_ANCHOR,
    order: PARITY_PATCH_ORDER,


    isActive: (context) => isPhaseActive(context),
    apply: (context) => {
      const anchor = context.checkAnchor(PHONG_LIGHTING_CHUNK_NAME, PARITY_ANCHOR);
      if (!anchor.found) {
        recordRefusal(anchor.reason);
        return false;
      }


      const applied = context.patchChunk("fragment", PHONG_LIGHTING_CHUNK_NAME, (chunkSource) =>
        rewritePhongLightingChunk(chunkSource),
      );
      if (applied) {
        appliedShaderCount++;
        lastRefusal = "";
      }
      return applied;
    },
  });


  function toFeatureReachPatchRows(registryState) {
    const patches =
      registryState && Array.isArray(registryState.registeredPatches) ? registryState.registeredPatches : [];
    return patches.map((patch) => ({
      id: patch.id,
      fase: patch.phase,
      ancora: patch.anchor,
      caminhos: MATERIAL_PATHS_BY_PATCH_ID[patch.id] || null,
    }));
  }


  function verifiableAnchorStatus() {
    const anchor = registry.checkAnchor(PHONG_LIGHTING_CHUNK_NAME, PARITY_ANCHOR);
    return { [PARITY_ANCHOR]: { ok: anchor.found, motivo: anchor.reason } };
  }

  function undeclaredPatchIds(registryState) {
    const patches =
      registryState && Array.isArray(registryState.registeredPatches) ? registryState.registeredPatches : [];
    return patches
      .map((patch) => patch.id)
      .filter((patchId) => !Object.prototype.hasOwnProperty.call(MATERIAL_PATHS_BY_PATCH_ID, patchId));
  }

  const phase = {
    phaseId: PHASE_ID,
    flagId: PARITY_FLAG_ID,
    patchId: PARITY_PATCH_ID,
    anchor: PARITY_ANCHOR,
    correctedPath: CORRECTED_PATH_ID,
    uniformNames: Object.freeze([PARITY_MIX_UNIFORM, PARITY_F0_UNIFORM]),
    gates: PARITY_GATES,

    mix() {
      const slot = registry.getUniformSlot(PARITY_MIX_UNIFORM);
      return slot ? slot.value : 0;
    },


    setMix(value) {
      const amount = saturate(Number(value));
      registry.setUniformValue(PARITY_MIX_UNIFORM, amount);
      llQa.setPhase(PHASE_ID, { mix: amount });
      return { uniform: PARITY_MIX_UNIFORM, mix: amount, recompiled: false };
    },

    f0() {
      const slot = registry.getUniformSlot(PARITY_F0_UNIFORM);
      return slot ? slot.value : DIELECTRIC_F0;
    },


    setF0(value) {
      const amount = saturate(Number(value));
      registry.setUniformValue(PARITY_F0_UNIFORM, amount);
      llQa.setPhase(PHASE_ID, { f0: amount });
      return { uniform: PARITY_F0_UNIFORM, f0: amount, recompiled: false };
    },


    setFlag(value) {
      return setLocalLightFlagOverride(PARITY_FLAG_ID, value);
    },

    isActive(context) {
      return isPhaseActive(context);
    },

    appliedCount() {
      return appliedShaderCount;
    },

    resetAppliedCount() {
      appliedShaderCount = 0;
      return appliedShaderCount;
    },


    plan(shininess) {
      return phongParityPlan({ shininess, f0: this.f0() });
    },


    audit() {
      const registryState = typeof registry.getState === "function" ? registry.getState() : null;
      const report = auditFeatureReach({
        registeredPatches: toFeatureReachPatchRows(registryState),
        anchorStatus: verifiableAnchorStatus(),
      });
      llQa.setPhase(PHASE_ID, {
        reachOk: report.ok,
        reachBlocking: report.blocking,
        reachPending: report.pending,
        reachCovered: report.coveredFeatures + "/" + report.totalFeatures,
      });
      return report;
    },

    verdict(measurement) {
      const decision = evaluateParityVerdict(measurement);
      llQa.setPhase(PHASE_ID, {
        ssim: decision.ssim,
        energyRatio: decision.energyRatio,
        verdict: decision.pass ? "ok" : "failed",
      });
      return decision;
    },


    status(context) {
      const frame = context && typeof context === "object" ? context : {};
      const flagDecision = resolveLocalLightFlag(PARITY_FLAG_ID, { tier: frame.tier });
      const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
      const technologyAllowed = isLocalLightTechnology(frame.technology);
      const anchor = registry.checkAnchor(PHONG_LIGHTING_CHUNK_NAME, PARITY_ANCHOR);
      const registryState = typeof registry.getState === "function" ? registry.getState() : null;
      const report = this.audit();
      const status = {
        phase: PHASE_ID,
        flag: PARITY_FLAG_ID,
        tier: frame.tier || null,
        technologyAllowed,
        flagOn: flagDecision.active,
        flagToken: flagDecision.token,
        flagSource: flagDecision.source,
        baselineFrozen,
        active: isPhaseActive(frame),
        mix: this.mix(),
        f0: this.f0(),
        chunk: PHONG_LIGHTING_CHUNK_NAME,
        correctedPath: CORRECTED_PATH_ID,
        paths: MATERIAL_PATHS.map((path) => path.id + " (" + path.specularModel + ")"),
        anchor: anchor.found ? "ok" : anchor.reason,
        patchedShaders: appliedShaderCount,
        reach: report.resumo,
        findings: report.findings.map((finding) => finding.severity + ": " + finding.detalhe),
        undeclaredPatchIds: undeclaredPatchIds(registryState),
        gates: PARITY_GATES,
        refusal: lastRefusal,
        pending: !technologyAllowed
          ? "Technology outside ShadowMap / Future keeps the legacy Blinn-Phong byte for byte"
          : baselineFrozen
            ? "LlBaseline is freezing the legacy path: release it for the phase to enter"
            : "Declared residual: LL-F6 cuts lights_physical_pars_fragment, which the pool program does not include, so the area specular still does not reach poolPhong - the audit reports it as blocking on purpose",
      };
      llQa.setPhase(PHASE_ID, {
        flagOn: flagDecision.active,
        technologyAllowed,
        baselineFrozen,
        mix: status.mix,
        f0: status.f0,
        patchedShaders: appliedShaderCount,
        anchorOk: anchor.found,
        refusal: lastRefusal,
      });
      return status;
    },
  };

  llQa.setPhase(PHASE_ID, {
    registered: true,
    flag: PARITY_FLAG_ID,
    patch: PARITY_PATCH_ID,
    anchor: PARITY_ANCHOR,
    chunk: PHONG_LIGHTING_CHUNK_NAME,
    uniforms: phase.uniformNames,
    correctedPath: CORRECTED_PATH_ID,
    textureUnits: 0,
  });

  return phase;
}
