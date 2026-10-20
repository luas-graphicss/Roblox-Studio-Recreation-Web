import { SB_MINIMUM_CHANNEL_TRANSMITTANCE } from "./sbTransmittanceCore.js"
import { SB_THIN_SHADER_PHASE_ASYMMETRY, SB_THIN_SLAB_EXTINCTION_PER_MILLIMETER } from "./sbThinTranslucencyCore.js"


function toGlslFloat(value) {
	if (value !== 0 && 0.001 > Math.abs(value)) return value.toExponential(1)
	return value.toFixed(4)
}

const uniformDeclaration = "uniform vec4 uSbThinTranslucency;"

const helperFunctions = `
const float SB_THIN_EXTINCTION_PER_MILLIMETER = ${toGlslFloat(SB_THIN_SLAB_EXTINCTION_PER_MILLIMETER)};
const float SB_THIN_PHASE_ASYMMETRY = ${toGlslFloat(SB_THIN_SHADER_PHASE_ASYMMETRY)};
const float SB_THIN_MINIMUM_CHANNEL_TRANSMITTANCE = ${toGlslFloat(SB_MINIMUM_CHANNEL_TRANSMITTANCE)};
const float SB_THIN_MINIMUM_PHASE_DENOMINATOR = 1.0e-4;

                                                                              
vec3 sbThinTransmittance( const in vec4 packedThinTranslucency ) {
	float opticalDepth = max( packedThinTranslucency.a, 0.0 ) * SB_THIN_EXTINCTION_PER_MILLIMETER;
	if ( 0.0 >= opticalDepth ) return vec3( 0.0 );
	vec3 transmittanceColor = clamp( packedThinTranslucency.rgb, SB_THIN_MINIMUM_CHANNEL_TRANSMITTANCE, 1.0 );
	float interaction = 1.0 - exp( - opticalDepth );
	vec3 survival = pow( transmittanceColor, vec3( opticalDepth ) );
	return interaction * survival;
}

                                                                  
vec3 sbThinTransmittanceWithinEnergyBudget( const in vec4 packedThinTranslucency, const in vec3 albedo ) {
	vec3 energyHeadroom = max( vec3( 1.0 ) - albedo, vec3( 0.0 ) );
	return min( sbThinTransmittance( packedThinTranslucency ), energyHeadroom );
}

                                                                          
float sbThinScatteringPhase( const in float scatteringCosine ) {
	float squaredAsymmetry = SB_THIN_PHASE_ASYMMETRY * SB_THIN_PHASE_ASYMMETRY;
	float denominator = 1.0 + squaredAsymmetry - 2.0 * SB_THIN_PHASE_ASYMMETRY * scatteringCosine;
	return ( 1.0 - squaredAsymmetry ) / ( 4.0 * PI * pow( max( denominator, SB_THIN_MINIMUM_PHASE_DENOMINATOR ), 1.5 ) );
}

                                                                          
                                                                           
vec3 sbThinTransmissionFromLight( const in vec3 transmittance, const in vec3 surfaceNormal, const in vec3 viewDirection, const in IncidentLight incidentLight ) {
	float backlitCosine = max( - dot( surfaceNormal, incidentLight.direction ), 0.0 );
	if ( 0.0 >= backlitCosine ) return vec3( 0.0 );
	float phase = sbThinScatteringPhase( dot( - incidentLight.direction, viewDirection ) );
	return incidentLight.color * ( backlitCosine * phase ) * transmittance;
}

                                                                              
                                                         
vec3 sbThinTransmissionFromEnvironment( const in vec3 transmittance, const in vec3 backsideIrradiance ) {
	return backsideIrradiance * RECIPROCAL_PI * transmittance;
}
`

const lightingAccumulation = `
#if defined( STANDARD )
	{
		vec3 sbThinTransmittanceValue = sbThinTransmittanceWithinEnergyBudget( uSbThinTranslucency, material.diffuseColor );
		if ( any( greaterThan( sbThinTransmittanceValue, vec3( 0.0 ) ) ) ) {
			IncidentLight sbThinIncidentLight;
			#if ( NUM_DIR_LIGHTS > 0 )
				for ( int sbThinDirectionalIndex = 0; sbThinDirectionalIndex < NUM_DIR_LIGHTS; sbThinDirectionalIndex ++ ) {
					getDirectionalLightInfo( directionalLights[ sbThinDirectionalIndex ], sbThinIncidentLight );
					if ( sbThinIncidentLight.visible ) {
						reflectedLight.directDiffuse += sbThinTransmissionFromLight( sbThinTransmittanceValue, geometryNormal, geometryViewDir, sbThinIncidentLight );
					}
				}
			#endif
			#if ( NUM_POINT_LIGHTS > 0 )
				for ( int sbThinPointIndex = 0; sbThinPointIndex < NUM_POINT_LIGHTS; sbThinPointIndex ++ ) {
					getPointLightInfo( pointLights[ sbThinPointIndex ], geometryPosition, sbThinIncidentLight );
					if ( sbThinIncidentLight.visible ) {
						reflectedLight.directDiffuse += sbThinTransmissionFromLight( sbThinTransmittanceValue, geometryNormal, geometryViewDir, sbThinIncidentLight );
					}
				}
			#endif
			#if ( NUM_SPOT_LIGHTS > 0 )
				for ( int sbThinSpotIndex = 0; sbThinSpotIndex < NUM_SPOT_LIGHTS; sbThinSpotIndex ++ ) {
					getSpotLightInfo( spotLights[ sbThinSpotIndex ], geometryPosition, sbThinIncidentLight );
					if ( sbThinIncidentLight.visible ) {
						reflectedLight.directDiffuse += sbThinTransmissionFromLight( sbThinTransmittanceValue, geometryNormal, geometryViewDir, sbThinIncidentLight );
					}
				}
			#endif
			#ifdef USE_ENVMAP
				reflectedLight.indirectDiffuse += sbThinTransmissionFromEnvironment( sbThinTransmittanceValue, getIBLIrradiance( - geometryNormal ) );
			#endif
		}
	}
#endif
`

export const SB_THIN_TRANSLUCENCY_GLSL = Object.freeze({
	uniformDeclaration,
	helperFunctions,
	lightingAccumulation,
})


export const SB_THIN_TRANSLUCENCY_GLSL_FUNCTION_NAMES = Object.freeze([
	"sbThinTransmittance",
	"sbThinTransmittanceWithinEnergyBudget",
	"sbThinScatteringPhase",
	"sbThinTransmissionFromLight",
	"sbThinTransmissionFromEnvironment",
])
