import { SB_ANISOTROPY_BEND_EXPONENT } from "./sbAnisotropyCore.js"
import { SB_MINIMUM_TANGENT_LENGTH } from "./sbTangentFrameCore.js"


function formatGlslFloat(value) {
	const precise = Number(value).toPrecision(10)
	if (precise.includes("e") || precise.includes("E")) return Number(value).toFixed(10)
	return precise.includes(".") ? precise : `${precise}.0`
}

export const SB_ANISOTROPY_UNIFORM_NAME = "uSbAnisotropy"


export const SB_ANISOTROPY_ANCHORS = Object.freeze({
	functions: "lightsPhysicalPars",
	application: "lightsFragmentEnd",
})


export const SB_ANISOTROPY_PROTECTED_SYMBOLS = Object.freeze([
	"geometryNormal",
	"geometryViewDir",
	"material",
	"radiance",
	"reflectedLight",
	"vUv",
	"vViewPosition",
])


export const SB_ANISOTROPY_MINIMUM_UV_DETERMINANT = 1e-8


export const SB_ANISOTROPY_RADIANCE_EPSILON = 1e-4


export const SB_ANISOTROPY_MAXIMUM_RADIANCE_RATIO = 4

const ANISOTROPY_FUNCTIONS_GLSL = `
                                                          
uniform vec2 ${SB_ANISOTROPY_UNIFORM_NAME};

const float SB_ANISOTROPY_MINIMUM_TANGENT_LENGTH = ${formatGlslFloat(SB_MINIMUM_TANGENT_LENGTH)};
const float SB_ANISOTROPY_MINIMUM_UV_DETERMINANT = ${formatGlslFloat(SB_ANISOTROPY_MINIMUM_UV_DETERMINANT)};
const float SB_ANISOTROPY_RADIANCE_EPSILON = ${formatGlslFloat(SB_ANISOTROPY_RADIANCE_EPSILON)};
const float SB_ANISOTROPY_MAXIMUM_RADIANCE_RATIO = ${formatGlslFloat(SB_ANISOTROPY_MAXIMUM_RADIANCE_RATIO)};
const float SB_ANISOTROPY_BEND_EXPONENT = ${formatGlslFloat(SB_ANISOTROPY_BEND_EXPONENT)};

float sbAnisotropyStrength() {
	return clamp( abs( ${SB_ANISOTROPY_UNIFORM_NAME}.x ), 0.0, 1.0 );
}

float sbAnisotropyRotation() {
	return ${SB_ANISOTROPY_UNIFORM_NAME}.y + (${SB_ANISOTROPY_UNIFORM_NAME}.x < 0.0 ? 1.57079632679 : 0.0);
}

                                                                            
                                                                             
                                                                            
bool sbSurfaceTangentFrame( const in vec3 surfaceNormal, out vec3 tangentDirection, out vec3 bitangentDirection ) {
	tangentDirection = vec3( 0.0 );
	bitangentDirection = vec3( 0.0 );
	#ifdef USE_UV
		vec3 positionDerivativeX = dFdx( - vViewPosition );
		vec3 positionDerivativeY = dFdy( - vViewPosition );
		vec2 uvDerivativeX = dFdx( vUv );
		vec2 uvDerivativeY = dFdy( vUv );
		float uvDeterminant = uvDerivativeX.x * uvDerivativeY.y - uvDerivativeY.x * uvDerivativeX.y;
		if ( SB_ANISOTROPY_MINIMUM_UV_DETERMINANT > abs( uvDeterminant ) ) return false;
		vec3 surfaceTangent = ( uvDerivativeY.y * positionDerivativeX - uvDerivativeX.y * positionDerivativeY ) / uvDeterminant;
		surfaceTangent = surfaceTangent - surfaceNormal * dot( surfaceNormal, surfaceTangent );
		float tangentLength = length( surfaceTangent );
		if ( SB_ANISOTROPY_MINIMUM_TANGENT_LENGTH > tangentLength ) return false;
		tangentDirection = surfaceTangent / tangentLength;
		bitangentDirection = cross( surfaceNormal, tangentDirection );
		return true;
	#else
		return false;
	#endif
}

                                                                         
                                                                 
void sbRotateTangentFrame( const in vec3 surfaceNormal, const in float rotationRadians, inout vec3 tangentDirection, inout vec3 bitangentDirection ) {
	vec3 rotatedTangent = normalize( tangentDirection * cos( rotationRadians ) + bitangentDirection * sin( rotationRadians ) );
	tangentDirection = rotatedTangent;
	bitangentDirection = cross( surfaceNormal, rotatedTangent );
}

                                                                               
                                                                     
                                                                         
vec3 sbAnisotropicBentNormal( const in vec3 surfaceNormal, const in vec3 bitangentDirection, const in vec3 viewDirection, const in float surfaceRoughness, const in float anisotropyStrength ) {
	vec3 bendPlaneNormal = cross( bitangentDirection, viewDirection );
	vec3 stretchedNormal = cross( bendPlaneNormal, bitangentDirection );
	if ( SB_ANISOTROPY_MINIMUM_TANGENT_LENGTH > length( stretchedNormal ) ) return surfaceNormal;
	float bendBlend = pow( clamp( 1.0 - anisotropyStrength * ( 1.0 - surfaceRoughness ), 0.0, 1.0 ), SB_ANISOTROPY_BEND_EXPONENT );
	return normalize( mix( normalize( stretchedNormal ), surfaceNormal, bendBlend ) );
}

                                                                          
                                                                                
                      
vec3 sbAnisotropicRadianceRatio( const in vec3 isotropicRadiance, const in vec3 anisotropicRadiance, const in float anisotropyStrength ) {
	vec3 radianceRatio = ( anisotropicRadiance + vec3( SB_ANISOTROPY_RADIANCE_EPSILON ) ) / ( isotropicRadiance + vec3( SB_ANISOTROPY_RADIANCE_EPSILON ) );
	radianceRatio = clamp( radianceRatio, vec3( 0.0 ), vec3( SB_ANISOTROPY_MAXIMUM_RADIANCE_RATIO ) );
	return mix( vec3( 1.0 ), radianceRatio, anisotropyStrength );
}
`

const ANISOTROPY_INDIRECT_APPLICATION_GLSL = `
                                                                                 
                                                                         
{
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
		float sbAnisotropyStrengthValue = sbAnisotropyStrength();
		vec3 sbAnisotropyTangent;
		vec3 sbAnisotropyBitangent;
		if ( sbAnisotropyStrengthValue > 0.0 && sbSurfaceTangentFrame( geometryNormal, sbAnisotropyTangent, sbAnisotropyBitangent ) ) {
			sbRotateTangentFrame( geometryNormal, sbAnisotropyRotation(), sbAnisotropyTangent, sbAnisotropyBitangent );
			vec3 sbAnisotropyBentNormal = sbAnisotropicBentNormal( geometryNormal, sbAnisotropyBitangent, geometryViewDir, material.roughness, sbAnisotropyStrengthValue );
			vec3 sbAnisotropyRadiance = getIBLRadiance( geometryViewDir, sbAnisotropyBentNormal, material.roughness );
			reflectedLight.indirectSpecular *= sbAnisotropicRadianceRatio( radiance, sbAnisotropyRadiance, sbAnisotropyStrengthValue );
		}
	#endif
}
`

export const SB_ANISOTROPY_GLSL = Object.freeze({
	functions: ANISOTROPY_FUNCTIONS_GLSL,
	indirectSpecularApplication: ANISOTROPY_INDIRECT_APPLICATION_GLSL,
})
