import {
	SB_SLAB_DIFFUSE_GRAZING_EXPONENT,
	SB_SLAB_DIFFUSE_GRAZING_HEMISPHERE_INTEGRAL,
	SB_SLAB_DIFFUSE_RETRO_STRENGTH_AT_FULL_ROUGHNESS,
} from "./sbSlabDiffuseCore.js"


function glslFloatLiteral(value) {
	return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

const declarations = [
	"#define SB_SLAB_DIFFUSE_GRAZING_EXPONENT " + glslFloatLiteral(SB_SLAB_DIFFUSE_GRAZING_EXPONENT),
	"#define SB_SLAB_DIFFUSE_GRAZING_HEMISPHERE_INTEGRAL " +
		glslFloatLiteral(SB_SLAB_DIFFUSE_GRAZING_HEMISPHERE_INTEGRAL),
	"#define SB_SLAB_DIFFUSE_RETRO_STRENGTH_AT_FULL_ROUGHNESS " +
		glslFloatLiteral(SB_SLAB_DIFFUSE_RETRO_STRENGTH_AT_FULL_ROUGHNESS),
].join("\n")

const code = [
	"// SB-F17 difusa do slab. Espelho de sbSlabDiffuseCore.js.",
	"float sbSlabDiffuseGrazingTail( const in float cosTheta ) {",
	"\treturn pow( clamp( 1.0 - cosTheta, 0.0, 1.0 ), SB_SLAB_DIFFUSE_GRAZING_EXPONENT );",
	"}",
	"",
	"float sbSlabDiffuseRetroStrength( const in float roughness ) {",
	"\treturn clamp( roughness, 0.0, 1.0 ) * SB_SLAB_DIFFUSE_RETRO_STRENGTH_AT_FULL_ROUGHNESS;",
	"}",
	"",
	"float sbSlabDiffuseLightShaping( const in float cosThetaLight, const in float retroStrength ) {",
	"\treturn 1.0 + retroStrength * sbSlabDiffuseGrazingTail( cosThetaLight );",
	"}",
	"",
	"// Normalizacao fechada: devolve o albedo direcional exato em qualquer vista.",
	"float sbSlabDiffuseEnergyNormalization( const in float retroStrength ) {",
	"\treturn 1.0 / ( 1.0 + retroStrength * SB_SLAB_DIFFUSE_GRAZING_HEMISPHERE_INTEGRAL );",
	"}",
	"",
	"vec3 sbSlabDiffuseBsdf( const in vec3 albedo, const in float roughness, const in float cosThetaLight ) {",
	"\tfloat retroStrength = sbSlabDiffuseRetroStrength( roughness );",
	"\tfloat shaping = sbSlabDiffuseLightShaping( cosThetaLight, retroStrength );",
	"\treturn albedo * RECIPROCAL_PI * shaping * sbSlabDiffuseEnergyNormalization( retroStrength );",
	"}",
	"",
	"// A energia que SOBRA do especular. Nunca negativa, nunca acima de 1.",
	"vec3 sbSlabDiffuseEnergyScale( const in vec3 specularDirectionalAlbedo ) {",
	"\treturn clamp( vec3( 1.0 ) - specularDirectionalAlbedo, vec3( 0.0 ), vec3( 1.0 ) );",
	"}",
	"",
	"vec3 sbSlabDiffuseCoupledBsdf( const in vec3 albedo, const in float roughness, const in float cosThetaLight, const in vec3 specularDirectionalAlbedo ) {",
	"\treturn sbSlabDiffuseBsdf( albedo, roughness, cosThetaLight ) * sbSlabDiffuseEnergyScale( specularDirectionalAlbedo );",
	"}",
].join("\n")

export const SB_SLAB_DIFFUSE_GLSL = { declarations, code }


export const SB_SLAB_DIFFUSE_GLSL_FUNCTION_NAMES = [
	"sbSlabDiffuseGrazingTail",
	"sbSlabDiffuseRetroStrength",
	"sbSlabDiffuseLightShaping",
	"sbSlabDiffuseEnergyNormalization",
	"sbSlabDiffuseBsdf",
	"sbSlabDiffuseEnergyScale",
	"sbSlabDiffuseCoupledBsdf",
]
