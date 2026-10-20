import {
	SB_EYE_CORNEA_IOR,
	SB_EYE_LIMBUS_START,
	SB_EYE_MINIMUM_CORNEA_ROUGHNESS,
	SB_EYE_PUPIL_SOFTNESS,
	corneaFresnelAtNormalIncidence,
} from "./sbEyeBsdfCore.js"


export const SB_EYE_MATERIAL_DEFINE = "SB_EYE_MATERIAL"


export const SB_EYE_DECLARATION_GUARD = "SB_EYE_BSDF_DECLARED"

function glslFloat(value) {
	return Number(value).toFixed(6)
}

export const SB_EYE_DECLARATIONS_CODE = [
	"#ifdef " + SB_EYE_MATERIAL_DEFINE,
	"#ifndef " + SB_EYE_DECLARATION_GUARD,
	"#define " + SB_EYE_DECLARATION_GUARD,
	"",
	"// SB-F25: cornea sobre iris. Espelho fiel de sbEyeBsdfCore.js.",
	"// uSbEye = vec4( irisDepth, pupilRadius, corneaRoughness, limbusDarkening )",
	"uniform vec4 uSbEye;",
	"",
	"const float SB_EYE_CORNEA_IOR = " + glslFloat(SB_EYE_CORNEA_IOR) + ";",
	"const float SB_EYE_CORNEA_F0 = " + glslFloat(corneaFresnelAtNormalIncidence()) + ";",
	"const float SB_EYE_LIMBUS_START = " + glslFloat(SB_EYE_LIMBUS_START) + ";",
	"const float SB_EYE_PUPIL_SOFTNESS = " + glslFloat(SB_EYE_PUPIL_SOFTNESS) + ";",
	"const float SB_EYE_MINIMUM_CORNEA_ROUGHNESS = " + glslFloat(SB_EYE_MINIMUM_CORNEA_ROUGHNESS) + ";",
	"",
	"float sbEyeRefractedTangent( const in float cosineView ) {",
	"\tfloat cosineIncidence = clamp( cosineView, 0.0, 1.0 );",
	"\tfloat sineIncidence = sqrt( max( 0.0, 1.0 - cosineIncidence * cosineIncidence ) );",
	"\tfloat sineRefracted = sineIncidence / SB_EYE_CORNEA_IOR;",
	"\tfloat cosineRefracted = sqrt( max( 1.0e-6, 1.0 - sineRefracted * sineRefracted ) );",
	"\treturn sineRefracted / cosineRefracted;",
	"}",
	"",
	"float sbEyeParallaxOffset( const in float cosineView, const in float irisDepth ) {",
	"\treturn irisDepth * sbEyeRefractedTangent( cosineView );",
	"}",
	"",
	"float sbEyeCorneaFresnel( const in float cosineView ) {",
	"\tfloat grazing = pow( 1.0 - clamp( cosineView, 0.0, 1.0 ), 5.0 );",
	"\treturn SB_EYE_CORNEA_F0 + ( 1.0 - SB_EYE_CORNEA_F0 ) * grazing;",
	"}",
	"",
	"float sbEyeIrisVisibility( const in float irisRadius, const in float shiftedRadius ) {",
	"\tfloat pupil = smoothstep( uSbEye.y, uSbEye.y + SB_EYE_PUPIL_SOFTNESS, shiftedRadius );",
	"\tfloat limbus = smoothstep( SB_EYE_LIMBUS_START, 1.0, irisRadius );",
	"\treturn pupil * ( 1.0 - uSbEye.w * limbus );",
	"}",
	"",
	"#endif",
	"#endif",
].join("\n")

export const SB_EYE_IRIS_CODE = [
	"#ifdef " + SB_EYE_MATERIAL_DEFINE,
	"#ifndef FLAT_SHADED",
	"\t{",
	"\t\t// Quadro alinhado a visao: raio 0 no ponto de frente, 1 na silhueta.",
	"\t\tfloat sbEyeCosineView = clamp( dot( normalize( vNormal ), normalize( vViewPosition ) ), 0.0, 1.0 );",
	"\t\tfloat sbEyeRadius = sqrt( max( 0.0, 1.0 - sbEyeCosineView * sbEyeCosineView ) );",
	"\t\tfloat sbEyeShiftedRadius = clamp( sbEyeRadius - sbEyeParallaxOffset( sbEyeCosineView, uSbEye.x ), 0.0, 1.0 );",
	"\t\tfloat sbEyeIrisWeight = sbEyeIrisVisibility( sbEyeRadius, sbEyeShiftedRadius );",
	"\t\t// A cornea reflete Fresnel; so o resto chega na iris. Energia fecha em 1.",
	"\t\tdiffuseColor.rgb *= sbEyeIrisWeight * ( 1.0 - sbEyeCorneaFresnel( sbEyeCosineView ) );",
	"\t}",
	"#endif",
	"#endif",
].join("\n")

export const SB_EYE_CORNEA_ROUGHNESS_CODE = [
	"#ifdef " + SB_EYE_MATERIAL_DEFINE,
	"\t// A superficie molhada da cornea manda na especular do globo.",
	"\troughnessFactor = clamp( uSbEye.z, SB_EYE_MINIMUM_CORNEA_ROUGHNESS, 1.0 );",
	"#endif",
].join("\n")


export const SB_EYE_GLSL_BLOCKS = Object.freeze([
	Object.freeze({ id: "sbEyeDeclarations", anchor: "common", code: SB_EYE_DECLARATIONS_CODE }),
	Object.freeze({ id: "sbEyeIrisParallax", anchor: "mapFragment", code: SB_EYE_IRIS_CODE }),
	Object.freeze({ id: "sbEyeCorneaRoughness", anchor: "roughnessMapFragment", code: SB_EYE_CORNEA_ROUGHNESS_CODE }),
])
