export const SB_CERTIFICATION_VERSION = "sb-f37-evidence-1"
export const SB_CERTIFICATION_SCENE_IDS = Object.freeze(Array.from({ length: 12 }, (_, index) => "scene" + String(index + 1).padStart(2, "0")))
export const SB_CERTIFICATION_RESIDUES = Object.freeze([
    Object.freeze({ id: "fixedTopologySlots", lines: Object.freeze([6, 7, 8]), statement: "WebGL2 uses fixed topology slots, not a variable per-pixel buffer." }),
    Object.freeze({ id: "emulatedOrderedTransparency", lines: Object.freeze([20]), statement: "Ordered transparency is emulated; pathological overlap uses a weighted fallback." }),
    Object.freeze({ id: "unverifiedUnreal59Deltas", lines: Object.freeze([]), statement: "Unreal 5.9-exclusive changes require a verified source or reference build." }),
    Object.freeze({ id: "glintDerivativeRequirement", lines: Object.freeze([15, 38]), statement: "Glints require stable derivatives and remain disabled on the weak tier." }),
    Object.freeze({ id: "screenSpaceSubsurfaceLimits", lines: Object.freeze([18, 19]), statement: "Screen-space diffusion does not solve thin grazing-angle transmission." }),
    Object.freeze({ id: "parallelMaterialLitePath", lines: Object.freeze([29, 30, 41]), statement: "The IL-F11 material-lite path remains disclosed until an explicit F33 retirement decision." }),
])
export const SB_BRIDGE_CHECK_IDS = Object.freeze([
    "approvedWorkbenchGates", "verifiedShaderAnchors", "textureBudgetWithLtc", "closureByteBudget",
    "bothLightingRenderBranches", "autoFlagAndWeakDefault", "unchangedQaSurface", "diaryAndEnginePlan", "reviewerNotified",
])
