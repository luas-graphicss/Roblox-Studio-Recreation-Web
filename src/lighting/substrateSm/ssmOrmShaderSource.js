export const SSM_ORM_UNIFORM_NAME = 'uSsmOrmMap';
export const SSM_ORM_DECLARATION = 'uniform sampler2D uSsmOrmMap;';
export const SSM_ORM_ROUGHNESS_READ = `vec4 ssmOrmSample = texture2D( uSsmOrmMap, vRoughnessMapUv );
float roughnessFactor = roughness * ssmOrmSample.g;`;
export const SSM_ORM_METALNESS_READ = 'float metalnessFactor = metalness * ssmOrmSample.b;';
export const SSM_ORM_AO_DECLARATION = `#ifdef USE_AOMAP
uniform float aoMapIntensity;
#endif`;

export const SSM_ORM_EXPECTED_CHUNKS = Object.freeze({
  roughnessmap_pars_fragment: '#ifdef USE_ROUGHNESSMAP\n\tuniform sampler2D roughnessMap;\n#endif',
  metalnessmap_pars_fragment: '#ifdef USE_METALNESSMAP\n\tuniform sampler2D metalnessMap;\n#endif',
  aomap_pars_fragment: '#ifdef USE_AOMAP\n\tuniform sampler2D aoMap;\n\tuniform float aoMapIntensity;\n#endif',
  roughnessmap_fragment: 'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n\tvec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );\n\troughnessFactor *= texelRoughness.g;\n#endif',
  metalnessmap_fragment: 'float metalnessFactor = metalness;\n#ifdef USE_METALNESSMAP\n\tvec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );\n\tmetalnessFactor *= texelMetalness.b;\n#endif',
});
