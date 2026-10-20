export const SB_SECOND_LOBE_UNIFORM_NAME = "uSbSecondLobe"


export const SB_DUAL_SPECULAR_LOBE_ANCHORS = Object.freeze({
	functions: "lightsPhysicalPars",
	indirect: "lightsFragmentEnd",
})

export const SB_DUAL_SPECULAR_LOBE_DECLARATIONS = `
                                               
uniform vec2 uSbSecondLobe;

const float SB_SECOND_LOBE_MINIMUM_ROUGHNESS = 0.001;

                                                                              
vec2 sbEnvironmentBrdfFit( const in float roughness, const in float dotNV ) {
	const vec4 lowFit = vec4( -1.0, -0.0275, -0.572, 0.022 );
	const vec4 highFit = vec4( 1.0, 0.0425, 1.04, -0.04 );
	vec4 fit = roughness * lowFit + highFit;
	float scaledBias = min( fit.x * fit.x, exp2( -9.28 * dotNV ) ) * fit.x + fit.y;
	return vec2( -1.04, 1.04 ) * scaledBias + fit.zw;
}

                                    
vec3 sbEnvironmentSpecularLobe( const in vec3 f0, const in float f90, const in float roughness, const in float dotNV ) {
	vec2 fit = sbEnvironmentBrdfFit( roughness, dotNV );
	return f0 * fit.x + f90 * fit.y;
}

                                                                          
                                                                          
float sbSecondLobeWeight() {
	return clamp( uSbSecondLobe.y, 0.0, 1.0 );
}

float sbSecondLobeRoughness() {
	return clamp( uSbSecondLobe.x, SB_SECOND_LOBE_MINIMUM_ROUGHNESS, 1.0 );
}

                                                                               
                                                                            
                                                      
vec3 sbSecondSpecularLobeIndirectDelta( const in vec3 baseRadiance, const in vec3 secondRadiance, const in vec3 normal, const in vec3 viewDirection, const in vec3 f0, const in float f90, const in float baseRoughness ) {
	float weight = sbSecondLobeWeight();
	if ( 0.0 >= weight ) return vec3( 0.0 );
	float dotNV = clamp( dot( normal, viewDirection ), 0.0, 1.0 );
	vec3 baseLobe = sbEnvironmentSpecularLobe( f0, f90, baseRoughness, dotNV );
	vec3 secondLobe = sbEnvironmentSpecularLobe( f0, f90, sbSecondLobeRoughness(), dotNV );
	return weight * ( secondRadiance * secondLobe - baseRadiance * baseLobe );
}
`

export const SB_DUAL_SPECULAR_LOBE_INDIRECT_CODE = `
                                                          
                                                                    
{
	float sbSecondLobeWeightValue = sbSecondLobeWeight();
	if ( sbSecondLobeWeightValue > 0.0 ) {
		float sbSecondLobeRoughnessValue = sbSecondLobeRoughness();
		vec3 sbSecondLobeRadiance = radiance;
		#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
			sbSecondLobeRadiance = getIBLRadiance( geometryViewDir, geometryNormal, sbSecondLobeRoughnessValue );
		#endif
		reflectedLight.indirectSpecular += sbSecondSpecularLobeIndirectDelta(
			radiance,
			sbSecondLobeRadiance,
			geometryNormal,
			geometryViewDir,
			material.specularColor,
			material.specularF90,
			material.roughness
		);
	}
}
`
