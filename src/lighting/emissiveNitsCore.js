export const REFERENCE_WHITE_NITS = 100;


export const NEON_NITS = 400;


export const CLASSIC_NEON_GAIN = 0.8;


export const PARTICLE_FULL_EMISSION_NITS = 400;

export const RENDER_STYLES = Object.freeze(["Classic", "Realistic"]);

function hardAssert(cond, msg) {
  if (!cond) throw new Error("emissiveNitsCore: " + msg);
}


export function normalizeRenderStyle(value) {
  return value === "Realistic" ? "Realistic" : "Classic";
}


export function nitsToRadiance(nits) {
  const n = typeof nits === "number" && Number.isFinite(nits) ? Math.max(0, nits) : 0;
  return n / REFERENCE_WHITE_NITS;
}


export function neonEmissiveGain(styleRaw) {
  const style = normalizeRenderStyle(styleRaw);
  const gain = style === "Realistic" ? nitsToRadiance(NEON_NITS) : CLASSIC_NEON_GAIN;
  hardAssert(Number.isFinite(gain) && gain > 0, "neonEmissiveGain não-finito (I3)");
  return gain;
}


export function particleEmissionBoost(lightEmission, styleRaw) {
  if (normalizeRenderStyle(styleRaw) !== "Realistic") return 1;
  let le = typeof lightEmission === "number" && Number.isFinite(lightEmission) ? lightEmission : 0;
  le = le < 0 ? 0 : le > 1 ? 1 : le;
  const full = nitsToRadiance(PARTICLE_FULL_EMISSION_NITS);
  const boost = 1 + (full - 1) * le;
  hardAssert(Number.isFinite(boost) && boost >= 1, "particleEmissionBoost fora do contrato (I2)");
  return boost;
}


export const LEGACY_NEON_DIFFUSE_BOOST = 2.2;


export function neonPoolEmissiveHdrGain(styleRaw) {
  const style = normalizeRenderStyle(styleRaw);
  if (style !== "Realistic") return 0;
  const gain = neonEmissiveGain(style);
  hardAssert(Number.isFinite(gain) && gain > 0, "neonPoolEmissiveHdrGain não-finito (I3)");
  return gain;
}


export function emissiveHdrPlan(styleRaw) {
  const style = normalizeRenderStyle(styleRaw);
  return Object.freeze({
    style,
    neonGain: neonEmissiveGain(style),
    particleBoostFull: particleEmissionBoost(1, style),
    referenceWhiteNits: REFERENCE_WHITE_NITS,
    neonNits: style === "Realistic" ? NEON_NITS : REFERENCE_WHITE_NITS * CLASSIC_NEON_GAIN,
  });
}


hardAssert(neonEmissiveGain("Classic") === CLASSIC_NEON_GAIN, "I1 quebrada: ganho Classic mudou");
hardAssert(particleEmissionBoost(1, "Classic") === 1, "I1 quebrada: boost Classic != 1");
hardAssert(particleEmissionBoost(0, "Realistic") === 1, "I2 quebrada: boost(0) != 1 no Realistic");
hardAssert(neonEmissiveGain("Realistic") >= CLASSIC_NEON_GAIN, "I2 quebrada: Realistic escurece o Neon");
hardAssert(neonPoolEmissiveHdrGain("Classic") === 0, "IL-F38: pools complexos ganharam emissivo no Classic (paridade quebrada)");
hardAssert(neonPoolEmissiveHdrGain("qualquer-lixo") === 0, "IL-F38: entrada inválida deveria cair em Classic (0)");
hardAssert(neonPoolEmissiveHdrGain("Realistic") === neonEmissiveGain("Realistic"), "IL-F38: ganho HDR dos pools difere do Neon das Parts");
hardAssert(LEGACY_NEON_DIFFUSE_BOOST === 2.2, "IL-F38: boost legado da difusa mudou — paridade A/B e Classic em risco");
