export const TREAD_LENGTH_UNMEASURED_TEXELS = 0;


function toFiniteNumber(value, fallback) {
	if (value === null || value === "" || typeof value === "boolean") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function texelsFrom(value) {
	return Math.max(0, toFiniteNumber(value, 0));
}

function clampToRange(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}


const UNMEASURED_TREAD = Object.freeze({
	treadTexels: 0,
	texelsFromTreadStart: 0,
	measured: false,
});


export function shadowEdgeTreadLengthTexels(rawInput) {
	const input = rawInput && typeof rawInput === "object" ? rawInput : {};
	const negativeTexels = texelsFrom(input.negativeTexels);
	const positiveTexels = texelsFrom(input.positiveTexels);
	const negativeEndIsJog = input.negativeEndIsJog === true;
	const positiveEndIsJog = input.positiveEndIsJog === true;


	const countedTexels = negativeTexels + positiveTexels + 1;
	if (negativeEndIsJog && positiveEndIsJog) {
		return Object.freeze({
			treadTexels: countedTexels,
			texelsFromTreadStart: negativeTexels,
			measured: true,
		});
	}
	if (!negativeEndIsJog && !positiveEndIsJog) return UNMEASURED_TREAD;


	const openSideIsSilhouetteEnd = negativeEndIsJog
		? input.positiveEndIsSilhouetteEnd === true
		: input.negativeEndIsSilhouetteEnd === true;
	const neighbourTreadTexels = texelsFrom(input.neighbourTreadTexels);
	const neighbourTreadWasMeasured =
		openSideIsSilhouetteEnd && neighbourTreadTexels > TREAD_LENGTH_UNMEASURED_TEXELS;
	const jogSideTexels = negativeEndIsJog ? negativeTexels : positiveTexels;
	const treadTexels = neighbourTreadWasMeasured
		? Math.max(neighbourTreadTexels, countedTexels)
		: jogSideTexels + texelsFrom(input.searchBudgetTexels) + 1;


	const texelsFromTreadStart = negativeEndIsJog
		? negativeTexels
		: treadTexels - positiveTexels - 1;
	return Object.freeze({
		treadTexels,
		texelsFromTreadStart: clampToRange(texelsFromTreadStart, 0, treadTexels - 1),
		measured: true,
	});
}


export function buildShadowEdgeRunLengthGlsl() {
	return `
                                                                              
                                                  
  
                                                                           
                                                                             
                                                                              
                                                                                
                                                                                
                                                                                 
                                                         
vec3 rswShadowEdgeTread(float negativeTexels, bool negativeEndIsJog, bool negativeEndIsSilhouetteEnd, float positiveTexels, bool positiveEndIsJog, bool positiveEndIsSilhouetteEnd, float neighbourTreadTexels, float searchBudgetTexels) {
                                                                                 
                                                       
  float countedTexels = negativeTexels + positiveTexels + 1.0;
  if (negativeEndIsJog && positiveEndIsJog) return vec3(countedTexels, negativeTexels, 1.0);
  if (!negativeEndIsJog && !positiveEndIsJog) return vec3(0.0, 0.0, 0.0);
  bool openSideIsSilhouetteEnd = negativeEndIsJog ? positiveEndIsSilhouetteEnd : negativeEndIsSilhouetteEnd;
  bool neighbourTreadWasMeasured = openSideIsSilhouetteEnd && neighbourTreadTexels > 0.0;
  float jogSideTexels = negativeEndIsJog ? negativeTexels : positiveTexels;
  float treadTexels = neighbourTreadWasMeasured
    ? max(neighbourTreadTexels, countedTexels)
    : jogSideTexels + searchBudgetTexels + 1.0;
                                                                             
                                                        
  float texelsFromTreadStart = negativeEndIsJog ? negativeTexels : treadTexels - positiveTexels - 1.0;
  return vec3(treadTexels, clamp(texelsFromTreadStart, 0.0, treadTexels - 1.0), 1.0);
}
`;
}
