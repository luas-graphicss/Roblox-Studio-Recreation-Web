import { SB_SPECULAR_PROFILE_LUT_SIZE, SB_SPECULAR_PROFILE_MAX_GAIN } from "./sbSpecularProfileCore.js"
import { SB_SPECULAR_PROFILE_NEUTRAL_INDEX, specularProfileCount } from "./sbSpecularProfileCatalog.js"

export const SB_SPECULAR_PROFILE_AVAILABILITY_MACRO = "SB_SPECULAR_PROFILE_AVAILABLE"
export const SB_SPECULAR_PROFILE_SAMPLER_UNIFORM_NAME = "uSbSpecularProfile"
export const SB_SPECULAR_PROFILE_INDEX_UNIFORM_NAME = "uSbSpecularProfileIndex"
export const SB_SPECULAR_PROFILE_SAMPLE_FUNCTION_NAME = "sbSampleSpecularProfileGain"


function toGlslFloat(value) {
	return Number.isInteger(value) ? value.toFixed(1) : String(value)
}

const GLSL_LUT_SIZE = toGlslFloat(SB_SPECULAR_PROFILE_LUT_SIZE)
const GLSL_PROFILE_COUNT = toGlslFloat(specularProfileCount())
const GLSL_MAX_GAIN = toGlslFloat(SB_SPECULAR_PROFILE_MAX_GAIN)
const GLSL_NEUTRAL_INDEX = String(SB_SPECULAR_PROFILE_NEUTRAL_INDEX)


export const SB_SPECULAR_PROFILE_DECLARATIONS = [
	"#define " + SB_SPECULAR_PROFILE_AVAILABILITY_MACRO + " 1",
	"uniform sampler2D " + SB_SPECULAR_PROFILE_SAMPLER_UNIFORM_NAME + ";",
	"uniform int " + SB_SPECULAR_PROFILE_INDEX_UNIFORM_NAME + ";",
	"const float SB_SPECULAR_PROFILE_LUT_SIZE = " + GLSL_LUT_SIZE + ";",
	"const float SB_SPECULAR_PROFILE_COUNT = " + GLSL_PROFILE_COUNT + ";",
	"const float SB_SPECULAR_PROFILE_MAX_GAIN = " + GLSL_MAX_GAIN + ";",
	"const int SB_SPECULAR_PROFILE_NEUTRAL_INDEX = " + GLSL_NEUTRAL_INDEX + ";",
	"// Do centro do primeiro texel ao centro do ultimo: a bilinear nunca sai da faixa do perfil.",
	"float sbSpecularProfileAxisCoordinate( float cosTheta ) {",
	"  return clamp( cosTheta, 0.0, 1.0 ) * ( SB_SPECULAR_PROFILE_LUT_SIZE - 1.0 ) + 0.5;",
	"}",
	"float " + SB_SPECULAR_PROFILE_SAMPLE_FUNCTION_NAME + "( float cosThetaView, float cosThetaLight, int profileIndex ) {",
	"  // Atalho do perfil neutro: ganho 1.0 exato, sem tocar na textura.",
	"  if ( profileIndex == SB_SPECULAR_PROFILE_NEUTRAL_INDEX ) return 1.0;",
	"  float atlasHeight = SB_SPECULAR_PROFILE_LUT_SIZE * SB_SPECULAR_PROFILE_COUNT;",
	"  float column = sbSpecularProfileAxisCoordinate( cosThetaView );",
	"  float rowInsideBand = sbSpecularProfileAxisCoordinate( cosThetaLight );",
	"  float row = float( profileIndex ) * SB_SPECULAR_PROFILE_LUT_SIZE + rowInsideBand;",
	"  vec2 atlasUv = vec2( column / SB_SPECULAR_PROFILE_LUT_SIZE, row / atlasHeight );",
	"  return texture2D( " + SB_SPECULAR_PROFILE_SAMPLER_UNIFORM_NAME + ", atlasUv ).r * SB_SPECULAR_PROFILE_MAX_GAIN;",
	"}",
].join("\n")

export const SB_SPECULAR_PROFILE_APPLICATION = [
	"#ifdef " + SB_SPECULAR_PROFILE_AVAILABILITY_MACRO,
	"  vec3 sbSpecularProfileViewDirection = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );",
	"  float sbSpecularProfileCosThetaView = clamp( dot( normal, sbSpecularProfileViewDirection ), 0.0, 1.0 );",
	"  float sbSpecularProfileGainValue = " +
		SB_SPECULAR_PROFILE_SAMPLE_FUNCTION_NAME +
		"( sbSpecularProfileCosThetaView, sbSpecularProfileCosThetaView, " +
		SB_SPECULAR_PROFILE_INDEX_UNIFORM_NAME +
		" );",
	"  #if !defined(SB_RUNTIME_SPECULAR_PROFILE_DIRECT) || defined(MGL_HISTORY_COMPOSITION_AVAILABLE)",
	"  reflectedLight.directSpecular *= sbSpecularProfileGainValue;",
	"  #endif",
	"  reflectedLight.indirectSpecular *= sbSpecularProfileGainValue;",
	"#endif",
].join("\n")


export function describeSpecularProfileGlsl() {
	return {
		availabilityMacro: SB_SPECULAR_PROFILE_AVAILABILITY_MACRO,
		samplerUniformName: SB_SPECULAR_PROFILE_SAMPLER_UNIFORM_NAME,
		indexUniformName: SB_SPECULAR_PROFILE_INDEX_UNIFORM_NAME,
		sampleFunctionName: SB_SPECULAR_PROFILE_SAMPLE_FUNCTION_NAME,
		lutSize: GLSL_LUT_SIZE,
		profileCount: GLSL_PROFILE_COUNT,
		maxGain: GLSL_MAX_GAIN,
		neutralIndex: GLSL_NEUTRAL_INDEX,
	}
}
