import {
	SB_HAIR_EUMELANIN_ABSORPTION,
	SB_HAIR_KERATIN_IOR,
	SB_HAIR_LONGITUDINAL_SHIFT_FACTORS,
	SB_HAIR_LONGITUDINAL_WIDTH_FACTORS,
	SB_HAIR_MAXIMUM_LONGITUDINAL_WIDTH,
	SB_HAIR_MINIMUM_PATH_COSINE,
	SB_HAIR_MINIMUM_ROUGHNESS,
	SB_HAIR_PATH_LENGTH_PER_PASS,
	keratinFresnelAtNormalIncidence,
} from "./sbHairBsdfCore.js"


export const SB_HAIR_MATERIAL_DEFINE = "SB_HAIR_MATERIAL"


export const SB_HAIR_DECLARATION_GUARD = "SB_HAIR_BSDF_DECLARED"


export const SB_HAIR_UNIFORM_NAME = "uSbHair"


export const SB_HAIR_ANCHORS = Object.freeze({
	declarations: "lightsPhysicalPars",
	application: "lightsFragmentEnd",
})


export const SB_HAIR_PROTECTED_SYMBOLS = Object.freeze([
	"geometryNormal",
	"geometryViewDir",
	"iblIrradiance",
	"irradiance",
	"material",
	"reflectedLight",
])


export const SB_HAIR_MINIMUM_VECTOR_LENGTH = 1e-6


function formatGlslFloat(value) {
	return Number(value).toFixed(6)
}

const HAIR_CONSTANTS_GLSL = [
	"const float SB_HAIR_KERATIN_IOR = " + formatGlslFloat(SB_HAIR_KERATIN_IOR) + ";",
	"const float SB_HAIR_KERATIN_F0 = " + formatGlslFloat(keratinFresnelAtNormalIncidence()) + ";",
	"const vec3 SB_HAIR_EUMELANIN_ABSORPTION = vec3( " +
		SB_HAIR_EUMELANIN_ABSORPTION.map(formatGlslFloat).join(", ") +
		" );",
	"const float SB_HAIR_PATH_LENGTH_PER_PASS = " + formatGlslFloat(SB_HAIR_PATH_LENGTH_PER_PASS) + ";",
	"const float SB_HAIR_MINIMUM_PATH_COSINE = " + formatGlslFloat(SB_HAIR_MINIMUM_PATH_COSINE) + ";",
	"const float SB_HAIR_MINIMUM_ROUGHNESS = " + formatGlslFloat(SB_HAIR_MINIMUM_ROUGHNESS) + ";",
	"const float SB_HAIR_MAXIMUM_LONGITUDINAL_WIDTH = " +
		formatGlslFloat(SB_HAIR_MAXIMUM_LONGITUDINAL_WIDTH) +
		";",
	"const float SB_HAIR_MINIMUM_VECTOR_LENGTH = " + formatGlslFloat(SB_HAIR_MINIMUM_VECTOR_LENGTH) + ";",
	"const float SB_HAIR_R_SHIFT_FACTOR = " + formatGlslFloat(SB_HAIR_LONGITUDINAL_SHIFT_FACTORS.R) + ";",
	"const float SB_HAIR_TT_SHIFT_FACTOR = " + formatGlslFloat(SB_HAIR_LONGITUDINAL_SHIFT_FACTORS.TT) + ";",
	"const float SB_HAIR_TRT_SHIFT_FACTOR = " + formatGlslFloat(SB_HAIR_LONGITUDINAL_SHIFT_FACTORS.TRT) + ";",
	"const float SB_HAIR_R_WIDTH_FACTOR = " + formatGlslFloat(SB_HAIR_LONGITUDINAL_WIDTH_FACTORS.R) + ";",
	"const float SB_HAIR_TT_WIDTH_FACTOR = " + formatGlslFloat(SB_HAIR_LONGITUDINAL_WIDTH_FACTORS.TT) + ";",
	"const float SB_HAIR_TRT_WIDTH_FACTOR = " + formatGlslFloat(SB_HAIR_LONGITUDINAL_WIDTH_FACTORS.TRT) + ";",
].join("\n")

const HAIR_READERS_GLSL = [
	"// Leitores do uniform: um nome legivel para cada componente congelado.",
	"float sbHairCuticleAngle() {",
	"\treturn " + SB_HAIR_UNIFORM_NAME + ".x;",
	"}",
	"",
	"float sbHairLongitudinalRoughness() {",
	"\treturn max( " + SB_HAIR_UNIFORM_NAME + ".y, SB_HAIR_MINIMUM_ROUGHNESS );",
	"}",
	"",
	"float sbHairRadialRoughness() {",
	"\treturn max( " + SB_HAIR_UNIFORM_NAME + ".z, SB_HAIR_MINIMUM_ROUGHNESS );",
	"}",
	"",
	"float sbHairMelanin() {",
	"\treturn clamp( " + SB_HAIR_UNIFORM_NAME + ".w, 0.0, 1.0 );",
	"}",
].join("\n")

const HAIR_FUNCTIONS_GLSL = [
	"// Fresnel de Schlick na interface ar -> queratina.",
	"float sbHairFresnel( const in float cosineIncidence ) {",
	"\tfloat grazing = pow( 1.0 - clamp( cosineIncidence, 0.0, 1.0 ), 5.0 );",
	"\treturn SB_HAIR_KERATIN_F0 + ( 1.0 - SB_HAIR_KERATIN_F0 ) * grazing;",
	"}",
	"",
	"// Transmitancia de UMA passagem pelo cortex (Beer-Lambert). O TRT usa o",
	"// quadrado dela, porque atravessa a fibra duas vezes.",
	"vec3 sbHairSinglePassTransmittance( const in float cosineDifference ) {",
	"\tfloat pathLength = SB_HAIR_PATH_LENGTH_PER_PASS / max( abs( cosineDifference ), SB_HAIR_MINIMUM_PATH_COSINE );",
	"\treturn exp( - SB_HAIR_EUMELANIN_ABSORPTION * ( sbHairMelanin() * pathLength ) );",
	"}",
	"",
	"// Largura longitudinal do lobo, com piso e teto iguais aos do nucleo.",
	"float sbHairLobeWidth( const in float widthFactor ) {",
	"\tfloat lobeWidth = widthFactor * sbHairLongitudinalRoughness();",
	"\treturn clamp( lobeWidth, SB_HAIR_MINIMUM_ROUGHNESS, SB_HAIR_MAXIMUM_LONGITUDINAL_WIDTH );",
	"}",
	"",
	"// Direcao do fio no plano tangente. RESIDUO: o eixo de referencia e o",
	"// vertical da VISTA enquanto o contrato nao reservar tangente de fibra.",
	"vec3 sbHairFiberTangent( const in vec3 shadingNormal ) {",
	"\tvec3 referenceAxis = vec3( 0.0, 1.0, 0.0 );",
	"\tvec3 fiberTangent = referenceAxis - shadingNormal * dot( referenceAxis, shadingNormal );",
	"\tfloat tangentLength = length( fiberTangent );",
	"\tif ( tangentLength > SB_HAIR_MINIMUM_VECTOR_LENGTH ) return fiberTangent / tangentLength;",
	"\treturn normalize( cross( shadingNormal, vec3( 0.0, 0.0, 1.0 ) ) );",
	"}",
	"",
	"// Normal girada DENTRO do plano longitudinal (normal, fio). Girar a normal",
	"// por metade do deslocamento move a direcao especular pelo deslocamento",
	"// inteiro: e este giro que faz o highlight primario ANDAR com a cuticula.",
	"vec3 sbHairShiftedNormal( const in vec3 shadingNormal, const in vec3 fiberTangent, const in float shiftRadians ) {",
	"\tfloat sineAlongFiber = clamp( dot( fiberTangent, shadingNormal ), -1.0, 1.0 );",
	"\tvec3 acrossFiber = shadingNormal - fiberTangent * sineAlongFiber;",
	"\tfloat acrossLength = length( acrossFiber );",
	"\tif ( SB_HAIR_MINIMUM_VECTOR_LENGTH > acrossLength ) return shadingNormal;",
	"\tfloat shiftedAngle = asin( sineAlongFiber ) + shiftRadians;",
	"\tvec3 acrossDirection = acrossFiber / acrossLength;",
	"\treturn normalize( acrossDirection * cos( shiftedAngle ) + fiberTangent * sin( shiftedAngle ) );",
	"}",
].join("\n")

const HAIR_DECLARATIONS_CODE = [
	"#ifdef " + SB_HAIR_MATERIAL_DEFINE,
	"#ifndef " + SB_HAIR_DECLARATION_GUARD,
	"#define " + SB_HAIR_DECLARATION_GUARD,
	"",
	"// SB-F24 -- fibra com os lobos R, TT e TRT. Espelho de sbHairBsdfCore.js.",
	"// " + SB_HAIR_UNIFORM_NAME + " = vec4( cuticleAngle, roughness, radialRoughness, melanin )",
	"uniform vec4 " + SB_HAIR_UNIFORM_NAME + ";",
	"",
	HAIR_CONSTANTS_GLSL,
	"",
	HAIR_READERS_GLSL,
	"",
	HAIR_FUNCTIONS_GLSL,
	"",
	"#endif",
	"#endif",
].join("\n")

const HAIR_APPLICATION_CODE = [
	"#ifdef " + SB_HAIR_MATERIAL_DEFINE,
	"{",
	"\t// SB-F24 -- os tres caminhos da fibra. Escopo proprio, para nao vazar nome,",
	"\t// e SUBSTITUINDO o especular indireto: a fibra e dona da especular dela.",
	"\tvec3 sbHairFiber = sbHairFiberTangent( geometryNormal );",
	"\tfloat sbHairViewCosine = clamp( dot( geometryNormal, geometryViewDir ), 0.0, 1.0 );",
	"\tfloat sbHairFresnelTerm = sbHairFresnel( sbHairViewCosine );",
	"\tvec3 sbHairPassTransmittance = sbHairSinglePassTransmittance( sbHairViewCosine );",
	"\tfloat sbHairEntryExit = ( 1.0 - sbHairFresnelTerm ) * ( 1.0 - sbHairFresnelTerm );",
	"\tvec3 sbHairAttenuationTT = sbHairEntryExit * sbHairPassTransmittance;",
	"\tvec3 sbHairAttenuationTRT = ( sbHairEntryExit * sbHairFresnelTerm ) * sbHairPassTransmittance * sbHairPassTransmittance;",
	"\tvec3 sbHairAmbientRadiance = ( irradiance + iblIrradiance ) * RECIPROCAL_PI;",
	"\tvec3 sbHairPrimaryRadiance = sbHairAmbientRadiance;",
	"\tvec3 sbHairInnerRadiance = sbHairAmbientRadiance;",
	"\t#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )",
	"\t\tfloat sbHairCuticleShift = 0.5 * sbHairCuticleAngle();",
	"\t\tvec3 sbHairPrimaryNormal = sbHairShiftedNormal( geometryNormal, sbHairFiber, SB_HAIR_R_SHIFT_FACTOR * sbHairCuticleShift );",
	"\t\tvec3 sbHairInnerNormal = sbHairShiftedNormal( geometryNormal, sbHairFiber, SB_HAIR_TRT_SHIFT_FACTOR * sbHairCuticleShift );",
	"\t\tsbHairPrimaryRadiance = getIBLRadiance( geometryViewDir, sbHairPrimaryNormal, sbHairLobeWidth( SB_HAIR_R_WIDTH_FACTOR ) );",
	"\t\tsbHairInnerRadiance = getIBLRadiance( geometryViewDir, sbHairInnerNormal, sbHairLobeWidth( SB_HAIR_TRT_WIDTH_FACTOR ) );",
	"\t#endif",
	"\tvec3 sbHairFiberColor = material.diffuseColor;",
	"\tvec3 sbHairRadiance = sbHairPrimaryRadiance * sbHairFresnelTerm",
	"\t\t+ sbHairAmbientRadiance * sbHairAttenuationTT * sbHairFiberColor",
	"\t\t+ sbHairInnerRadiance * sbHairAttenuationTRT * sbHairFiberColor;",
	"\treflectedLight.indirectSpecular = max( sbHairRadiance, vec3( 0.0 ) );",
	"}",
	"#endif",
].join("\n")


export const SB_HAIR_GLSL_BLOCKS = Object.freeze([
	Object.freeze({ id: "sbHairDeclarations", anchor: SB_HAIR_ANCHORS.declarations, code: HAIR_DECLARATIONS_CODE }),
	Object.freeze({ id: "sbHairIndirectLobes", anchor: SB_HAIR_ANCHORS.application, code: HAIR_APPLICATION_CODE }),
])

export const SB_HAIR_GLSL = Object.freeze({
	declarations: HAIR_DECLARATIONS_CODE,
	application: HAIR_APPLICATION_CODE,
})
