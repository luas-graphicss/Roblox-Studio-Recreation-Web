export const RECEIVER_PLANE_TRUST_TEXEL_REACH = 1;


export const RECEIVER_PLANE_TRUST_FADE_START_FRACTION = 0.5;


export const RECEIVER_PLANE_TRUST_DEFAULT_MAP_PIXELS = 2048;

function finiteOrZero(value) {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
}


export function receiverPlaneSlopeLimitPerUv({ planeBiasCap, texelUv } = {}) {
	const cap = finiteOrZero(planeBiasCap);
	const texel = finiteOrZero(texelUv);
	if (cap <= 0 || texel <= 0) return 0;
	const reach = texel * RECEIVER_PLANE_TRUST_TEXEL_REACH;
	if (reach <= 0) return 0;
	return cap / reach;
}


export function receiverPlaneTrustFactor({ slopePerUv, slopeLimitPerUv } = {}) {
	const limit = finiteOrZero(slopeLimitPerUv);
	const slope = finiteOrZero(slopePerUv);
	if (limit <= 0) return 1;
	const fadeStart = limit * RECEIVER_PLANE_TRUST_FADE_START_FRACTION;
	if (slope <= fadeStart) return 1;
	if (slope >= limit) return 0;
	const t = (slope - fadeStart) / (limit - fadeStart);
	return 1 - t * t * (3 - 2 * t);
}


export function trustedReceiverPlaneGradient({ dzduv, planeBiasCap, texelUv } = {}) {
	const gradient = dzduv || [];
	const du = finiteOrZero(gradient[0]);
	const dv = finiteOrZero(gradient[1]);
	if (du === 0 && dv === 0) return [0, 0];
	const slopeLimitPerUv = receiverPlaneSlopeLimitPerUv({ planeBiasCap, texelUv });
	if (slopeLimitPerUv <= 0) return [du, dv];
	const trust = receiverPlaneTrustFactor({
		slopePerUv: Math.hypot(du, dv),
		slopeLimitPerUv,
	});
	if (trust >= 1) return [du, dv];
	if (trust <= 0) return [0, 0];
	return [du * trust, dv * trust];
}


export function buildReceiverPlaneTrustGlsl() {
	return (
		"\n" +
		"// Receiver plane trust: a plane that saturates the plane bias cap within\n" +
		"// one texel is the depth jump of a CONTACT, not a plane, so its gradient is\n" +
		"// rejected instead of clamped (shadowReceiverPlaneTrust.js owns the rule\n" +
		"// and the derivation). Faded over the last octave: no seam on curved\n" +
		"// receivers, and real ramps keep their gradient untouched.\n" +
		"float rswReceiverPlaneTrust(const in float slopePerUv, const in float slopeLimitPerUv) {\n" +
		"  if (slopeLimitPerUv <= 0.0) return 1.0;\n" +
		"  return 1.0 - smoothstep(slopeLimitPerUv * " +
		RECEIVER_PLANE_TRUST_FADE_START_FRACTION.toFixed(1) +
		", slopeLimitPerUv, slopePerUv);\n" +
		"}\n" +
		"vec2 rswTrustedReceiverPlane(const in vec2 dzduv, const in float texelUv, const in float planeBiasCap) {\n" +
		"  float rswPlaneReachUv = max(texelUv * " +
		RECEIVER_PLANE_TRUST_TEXEL_REACH.toFixed(1) +
		", 1e-9);\n" +
		"  float rswPlaneSlopeLimit = planeBiasCap / rswPlaneReachUv;\n" +
		"  return dzduv * rswReceiverPlaneTrust(length(dzduv), rswPlaneSlopeLimit);\n" +
		"}\n"
	);
}
