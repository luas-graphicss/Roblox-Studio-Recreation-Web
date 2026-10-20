export const CERTIFICATION_SCHEMA = "1.0.0";
export const CERTIFICATION_SESSION_SETTING = "CP-F36.certificationSession";
export const CERTIFICATION_CLAIM_SETTING = "CP-F36.requestedClaim";
export const CERTIFICATION_BINDING_SETTING = "CP-F36.runtimeBinding";
export const CERTIFICATION_STATE_RESOURCE = "CP-F36.certificationState";
export const REQUIRED_GATES = Object.freeze(["contract", "cpu", "gpu", "temporal", "reference", "performance", "integration"]);
export const CROSS_FEATURE_CASES = Object.freeze(["exposure-bloom", "local-exposure-flare", "dof-tsr-motion-blur-translucency", "grading-lut-hdr", "grain-capture", "resize-history-pre-exposure", "future-classic-safe-mode", "quality-degradations", "all-features", "neutral-bypass", "adversarial-inputs"]);
export const PRODUCT_CASES = Object.freeze(["edit", "play", "photo", "terrain", "pools", "skinned", "particles", "megalights", "substrate", "two-views", "settings-persistence", "single-presentation", "single-exposure", "single-jitter", "single-tonemapper", "single-oetf", "deferred-boot", "context-restore", "rollback"]);
