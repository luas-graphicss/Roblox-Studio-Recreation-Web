export const AXIS_STEP_LENGTH_TEXELS = 1;


export const DIAGONAL_STEP_LENGTH_TEXELS = Math.SQRT2;


export const WALK_FRAME_DIAGONAL_RISING = "diagonal-rising";


export const WALK_FRAME_DIAGONAL_FALLING = "diagonal-falling";


export const SHADOW_EDGE_DIAGONAL_WALK_FRAMES = [
	{
		name: WALK_FRAME_DIAGONAL_RISING,
		alongStep: { x: 1, y: 1 },
		acrossStep: { x: 1, y: -1 },
	},
	{
		name: WALK_FRAME_DIAGONAL_FALLING,
		alongStep: { x: 1, y: -1 },
		acrossStep: { x: 1, y: 1 },
	},
];

function dotProduct(first, second) {
	return first.x * second.x + first.y * second.y;
}


export function walkFrameStepLengthTexels(step) {
	const safeStep = step ?? { x: 0, y: 0 };
	const length = Math.hypot(safeStep.x ?? 0, safeStep.y ?? 0);
	return length > 0 ? length : AXIS_STEP_LENGTH_TEXELS;
}


export function walkFrameSubTexelPosition({ alongStep, acrossStep, offsetFromTexelCentre }) {
	const alongStepLengthSquared = dotProduct(alongStep, alongStep);
	const acrossStepLengthSquared = dotProduct(acrossStep, acrossStep);
	return {
		alongSubTexel:
			dotProduct(offsetFromTexelCentre, alongStep) / Math.max(alongStepLengthSquared, 1) + 0.5,
		acrossSubTexel:
			dotProduct(offsetFromTexelCentre, acrossStep) / Math.max(acrossStepLengthSquared, 1),
	};
}


export function buildShadowEdgeWalkFrameGlsl() {
	const axisStepLength = AXIS_STEP_LENGTH_TEXELS.toFixed(1);
	return `
                                                                           
                                               
float rswShadowEdgeWalkFrameStepLength(vec2 stepTexels) {
  float stepLength = length(stepTexels);
  return stepLength > 0.0 ? stepLength : ${axisStepLength};
}
                                                                               
                                                                           
                                                            
                             
vec2 rswShadowEdgeWalkFrameSubTexel(vec2 offsetFromTexelCentre, vec2 alongStepTexels, vec2 acrossStepTexels) {
  float alongSubTexel = dot(offsetFromTexelCentre, alongStepTexels) / max(dot(alongStepTexels, alongStepTexels), 1.0) + 0.5;
  float acrossSubTexel = dot(offsetFromTexelCentre, acrossStepTexels) / max(dot(acrossStepTexels, acrossStepTexels), 1.0);
  return vec2(alongSubTexel, acrossSubTexel);
}
`;
}
