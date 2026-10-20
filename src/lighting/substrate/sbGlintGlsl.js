import {
	SB_GLINT_COUNT_ITERATION_CEILING,
	SB_GLINT_MINIMUM_LIT_FRACTION,
	SB_GLINT_MINIMUM_ROUGHNESS,
	SB_GLINT_NORMAL_APPROXIMATION_THRESHOLD,
} from "./sbGlintCore.js"
import { SB_GLINT_BASE_CELL_SIZE, SB_GLINT_COARSEST_LEVEL } from "./sbGlintLodCore.js"
import { SB_GLINT_LUT_HEIGHT, SB_GLINT_LUT_MAXIMUM_DENSITY, SB_GLINT_LUT_WIDTH } from "./sbGlintLutCore.js"


function toGlslFloat(value) {
	const numericValue = Number(value)
	if (!Number.isFinite(numericValue)) return "0.0"
	const text = numericValue.toFixed(8).replace(/0+$/, "")
	return text.endsWith(".") ? text + "0" : text
}

function toGlslInteger(value) {
	return String(Math.trunc(Number(value) || 0))
}


export const SB_GLINT_UNIFORM_DECLARATIONS_GLSL = [
	"// SB-F15: x = densidade de flocos, y = rugosidade do floco, z = semente",
	"uniform vec3 uSbGlint;",
	"uniform sampler2D uSbGlintLut;",
].join("\n")

const GLINT_GLSL_CONSTANTS = [
	`const float SB_GLINT_BASE_CELL_SIZE = ${toGlslFloat(SB_GLINT_BASE_CELL_SIZE)};`,
	`const float SB_GLINT_COARSEST_LEVEL = ${toGlslFloat(SB_GLINT_COARSEST_LEVEL)};`,
	`const float SB_GLINT_NORMAL_APPROXIMATION_THRESHOLD = ${toGlslFloat(SB_GLINT_NORMAL_APPROXIMATION_THRESHOLD)};`,
	`const int SB_GLINT_COUNT_ITERATION_CEILING = ${toGlslInteger(SB_GLINT_COUNT_ITERATION_CEILING)};`,
	`const float SB_GLINT_MINIMUM_LIT_FRACTION = ${toGlslFloat(SB_GLINT_MINIMUM_LIT_FRACTION)};`,
	`const float SB_GLINT_MINIMUM_ROUGHNESS = ${toGlslFloat(SB_GLINT_MINIMUM_ROUGHNESS)};`,
	`const float SB_GLINT_LUT_WIDTH = ${toGlslFloat(SB_GLINT_LUT_WIDTH)};`,
	`const float SB_GLINT_LUT_HEIGHT = ${toGlslFloat(SB_GLINT_LUT_HEIGHT)};`,
	`const float SB_GLINT_LUT_MAXIMUM_DENSITY = ${toGlslFloat(SB_GLINT_LUT_MAXIMUM_DENSITY)};`,
	"const float SB_GLINT_TWO_PI = 6.283185307179586;",
].join("\n")

const GLINT_HASH_GLSL = `
                                                                   
float sbGlintHashToUnitFloat( vec4 cellKey, float streamIndex ) {
	vec4 streamedKey = cellKey + vec4( streamIndex * 0.7548776662, streamIndex * 0.5698402909, streamIndex * 0.3819660113, 1.0 );
	float hashed = dot( streamedKey, vec4( 127.1, 311.7, 74.7, 269.5 ) );
	return fract( sin( hashed ) * 43758.5453123 );
}
`.trim()

const GLINT_COUNT_GLSL = `
                                                                                 
float sbGlintLitFraction( float baseRoughness ) {
	float flakeRoughness = max( uSbGlint.y, 0.0 );
	float clampedBaseRoughness = max( baseRoughness, SB_GLINT_MINIMUM_ROUGHNESS );
	float fraction = ( flakeRoughness * flakeRoughness ) / ( clampedBaseRoughness * clampedBaseRoughness );
	return clamp( fraction, SB_GLINT_MINIMUM_LIT_FRACTION, 1.0 );
}

                                                                               
float sbGlintMicrofacetCount( float expectedCount, vec4 cellKey ) {
	if ( expectedCount < SB_GLINT_NORMAL_APPROXIMATION_THRESHOLD ) {
		float limit = exp( - expectedCount );
		float product = 1.0;
		float count = 0.0;
		for ( int iteration = 0; iteration < SB_GLINT_COUNT_ITERATION_CEILING; iteration ++ ) {
			product *= sbGlintHashToUnitFloat( cellKey, float( iteration ) + 1.0 );
			if ( product <= limit ) break;
			count += 1.0;
		}
		return count;
	}
	float firstUniform = max( sbGlintHashToUnitFloat( cellKey, 1.0 ), 1e-6 );
	float secondUniform = sbGlintHashToUnitFloat( cellKey, 2.0 );
	float gaussian = sqrt( - 2.0 * log( firstUniform ) ) * cos( SB_GLINT_TWO_PI * secondUniform );
	return max( floor( expectedCount + sqrt( expectedCount ) * gaussian + 0.5 ), 0.0 );
}
`.trim()

const GLINT_LOD_GLSL = `
                                                                         
vec4 sbGlintLutRow( float level ) {
	float densityAxis = clamp( log( 1.0 + uSbGlint.x ) / log( 1.0 + SB_GLINT_LUT_MAXIMUM_DENSITY ), 0.0, 1.0 );
	float column = ( densityAxis * ( SB_GLINT_LUT_WIDTH - 1.0 ) + 0.5 ) / SB_GLINT_LUT_WIDTH;
	float row = ( level + 0.5 ) / SB_GLINT_LUT_HEIGHT;
	return texture2D( uSbGlintLut, vec2( column, row ) );
}

                                                                                  
float sbGlintLevelRatio( vec2 surfaceCoordinates, float level, float litFraction ) {
	float cellSize = SB_GLINT_BASE_CELL_SIZE * exp2( level );
	float expectedCount = uSbGlint.x * cellSize * cellSize * litFraction;
	if ( expectedCount <= 0.0 ) return 1.0;
	vec2 cell = floor( surfaceCoordinates / cellSize );
	float count = sbGlintMicrofacetCount( expectedCount, vec4( cell, level, uSbGlint.z ) );
	return mix( count / expectedCount, 1.0, sbGlintLutRow( level ).b );
}

                                                                                 
                                                                                
                                                                         
vec2 sbGlintSurfaceCoordinates( vec3 worldPosition, vec3 worldNormal ) {
	vec3 axisWeight = abs( worldNormal );
	if ( axisWeight.x >= axisWeight.y && axisWeight.x >= axisWeight.z ) return worldPosition.zy;
	if ( axisWeight.y >= axisWeight.z ) return worldPosition.xz;
	return worldPosition.xy;
}

                                                          
float sbGlintSpecularModulation( vec2 surfaceCoordinates, float baseRoughness ) {
	if ( uSbGlint.x <= 0.0 ) return 1.0;
	vec2 derivativeAlongScreenX = dFdx( surfaceCoordinates );
	vec2 derivativeAlongScreenY = dFdy( surfaceCoordinates );
	float footprintArea = abs( derivativeAlongScreenX.x * derivativeAlongScreenY.y - derivativeAlongScreenX.y * derivativeAlongScreenY.x );
	if ( footprintArea <= 0.0 ) return 1.0;
	float baseCellArea = SB_GLINT_BASE_CELL_SIZE * SB_GLINT_BASE_CELL_SIZE;
	float rawLevel = max( 0.5 * log2( footprintArea / baseCellArea ), 0.0 );
	float clampedLevel = min( rawLevel, SB_GLINT_COARSEST_LEVEL );
	float lowerLevel = floor( clampedLevel );
	float upperLevel = min( lowerLevel + 1.0, SB_GLINT_COARSEST_LEVEL );
	float litFraction = sbGlintLitFraction( baseRoughness );
	float lowerRatio = sbGlintLevelRatio( surfaceCoordinates, lowerLevel, litFraction );
	float upperRatio = upperLevel == lowerLevel ? lowerRatio : sbGlintLevelRatio( surfaceCoordinates, upperLevel, litFraction );
	float blendedRatio = mix( lowerRatio, upperRatio, clampedLevel - lowerLevel );
	float smoothFadeWeight = clamp( rawLevel - SB_GLINT_COARSEST_LEVEL, 0.0, 1.0 );
	return mix( blendedRatio, 1.0, smoothFadeWeight );
}
`.trim()


export const SB_GLINT_PARS_GLSL = [GLINT_GLSL_CONSTANTS, GLINT_HASH_GLSL, GLINT_COUNT_GLSL, GLINT_LOD_GLSL].join("\n\n")








export const SB_GLINT_APPLY_GLSL = `
{
	mat3 sbGlintViewRotation = mat3( viewMatrix );
	vec3 sbGlintWorldPosition = cameraPosition + ( - vViewPosition ) * sbGlintViewRotation;
	vec3 sbGlintWorldNormal = normalize( normal * sbGlintViewRotation );
	vec2 sbGlintCoordinates = sbGlintSurfaceCoordinates( sbGlintWorldPosition, sbGlintWorldNormal );
	float sbGlintFactor = sbGlintSpecularModulation( sbGlintCoordinates, material.roughness );
	reflectedLight.directSpecular *= sbGlintFactor;
	reflectedLight.indirectSpecular *= sbGlintFactor;
}
`.trim()


export function glintGlslReport() {
	const combinedSource = [SB_GLINT_UNIFORM_DECLARATIONS_GLSL, SB_GLINT_PARS_GLSL, SB_GLINT_APPLY_GLSL].join("\n")
	return {
		declarationLineCount: SB_GLINT_UNIFORM_DECLARATIONS_GLSL.split("\n").length,
		parsLineCount: SB_GLINT_PARS_GLSL.split("\n").length,
		applyLineCount: SB_GLINT_APPLY_GLSL.split("\n").length,
		declaredUniformNames: ["uSbGlint", "uSbGlintLut"].filter((uniformName) => combinedSource.includes(uniformName)),
		usesScreenDerivatives: combinedSource.includes("dFdx(") || combinedSource.includes("dFdx( "),
		usesGlintLut: combinedSource.includes("texture2D( uSbGlintLut"),
		modulatesDirectSpecular: combinedSource.includes("reflectedLight.directSpecular *= sbGlintFactor"),
		hasIncludeDirective: combinedSource.includes("#include"),
		referencesFrameTime: /uSbTime|frameIndex|elapsedSeconds/.test(combinedSource),
		constantSource: GLINT_GLSL_CONSTANTS,
	}
}
