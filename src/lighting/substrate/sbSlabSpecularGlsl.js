import {
	SB_AVERAGE_FRESNEL_TAIL_WEIGHT,
	SB_MINIMUM_WHITE_FURNACE_ALBEDO,
	SB_WHITE_FURNACE_ALBEDO_COEFFICIENTS,
} from "./sbEnvBrdfCore.js"


export const SB_SLAB_SPECULAR_PROTECTED_SYMBOLS = Object.freeze([
	"normal",
	"geometryNormal",
	"geometryViewDir",
	"vViewPosition",
	"geometryRoughness",
	"roughnessFactor",
	"material",
])


function formatGlslFloat(value) {
	const text = value.toPrecision(10)
	if (text.indexOf("e") >= 0 || text.indexOf("E") >= 0) return value.toFixed(10)
	return text.indexOf(".") >= 0 ? text : text + ".0"
}


function hornerInShadowing(coefficients) {
	let expression = formatGlslFloat(coefficients[coefficients.length - 1])
	for (let index = coefficients.length - 2; index >= 0; index -= 1) {
		expression = formatGlslFloat(coefficients[index]) + " + shadowing * ( " + expression + " )"
	}
	return expression
}

function declareRoughnessTerms(rows) {
	return rows.map((row, index) => "\tfloat roughnessTerm" + (index + 1) + " = " + hornerInShadowing(row) + ";").join("\n")
}


function hornerInRoughness(rowCount) {
	let expression = "roughnessTerm" + rowCount
	for (let index = rowCount - 1; index >= 1; index -= 1) {
		expression = "roughnessTerm" + index + " + roughness * ( " + expression + " )"
	}
	return "roughness * ( " + expression + " )"
}

const ROUGHNESS_TERM_LINES = declareRoughnessTerms(SB_WHITE_FURNACE_ALBEDO_COEFFICIENTS)
const MISSING_ENERGY_EXPRESSION = hornerInRoughness(SB_WHITE_FURNACE_ALBEDO_COEFFICIENTS.length)
const MINIMUM_ALBEDO_LITERAL = formatGlslFloat(SB_MINIMUM_WHITE_FURNACE_ALBEDO)
const TAIL_WEIGHT_LITERAL = formatGlslFloat(SB_AVERAGE_FRESNEL_TAIL_WEIGHT)


const SPECULAR_ENERGY_FUNCTIONS = `
                                                                            
                                                                     
float sbSmithShadowingVariable( const in float cosThetaView, const in float roughness ) {
	float alpha = roughness * roughness;
	float clampedCosine = clamp( cosThetaView, 0.0, 1.0 );
	float sinTheta = sqrt( max( 0.0, 1.0 - clampedCosine * clampedCosine ) );
	return 1.0 / ( 1.0 + clampedCosine / max( alpha * sinTheta, 1e-6 ) );
}

float sbWhiteFurnaceDirectionalAlbedo( const in float cosThetaView, const in float roughness ) {
	float shadowing = sbSmithShadowingVariable( cosThetaView, roughness );
${ROUGHNESS_TERM_LINES}
	float missingEnergy = ${MISSING_ENERGY_EXPRESSION};
	return clamp( 1.0 - missingEnergy, ${MINIMUM_ALBEDO_LITERAL}, 1.0 );
}

vec3 sbAverageFresnel( const in vec3 f0, const in float f90 ) {
	return f0 + ( vec3( f90 ) - f0 ) * ${TAIL_WEIGHT_LITERAL};
}

vec3 sbMultiScatterEnergyScale( const in float whiteAlbedo, const in vec3 averageFresnelValue ) {
	float albedo = clamp( whiteAlbedo, ${MINIMUM_ALBEDO_LITERAL}, 1.0 );
	return vec3( 1.0 ) + averageFresnelValue * ( ( 1.0 - albedo ) / albedo );
}
`







const DIRECT_SPECULAR_COMPENSATION = `
                                                                                
{
	float sbCosThetaView = saturate( dot( normal, geometryViewDir ) );
	float sbWhiteAlbedo = sbWhiteFurnaceDirectionalAlbedo( sbCosThetaView, material.roughness );
	vec3 sbAverageFresnelValue = sbAverageFresnel( material.specularColor, material.specularF90 );
	reflectedLight.directSpecular *= sbMultiScatterEnergyScale( sbWhiteAlbedo, sbAverageFresnelValue );
}
`

export const SB_SLAB_SPECULAR_GLSL = Object.freeze({
	functions: SPECULAR_ENERGY_FUNCTIONS,
	directSpecularCompensation: DIRECT_SPECULAR_COMPENSATION,
})
