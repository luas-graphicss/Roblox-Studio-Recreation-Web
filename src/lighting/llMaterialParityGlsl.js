export const PHONG_LIGHTING_CHUNK_NAME = "lights_phong_pars_fragment";
export const PARITY_MIX_UNIFORM = "uLlMaterialParityMix";
export const PARITY_F0_UNIFORM = "uLlMaterialParityF0";
export const PARITY_FUNCTION_NAME = "llMaterialParitySpecular";
export const LEGACY_SPECULAR_CALL = "BRDF_BlinnPhong(";

export function buildParityGlsl() {
  return [
    "// LL-F8 paridade de material: pool Phong com a BRDF especular do Standard.",
    "uniform float " + PARITY_MIX_UNIFORM + ";",
    "uniform float " + PARITY_F0_UNIFORM + ";",
    "float llMaterialParityRoughness( const in float shininess ) {",
    "\tfloat safeShininess = max( shininess, 1.0 );",
    "\treturn clamp( pow( 2.0 / ( safeShininess + 2.0 ), 0.25 ), 0.0525, 1.0 );",
    "}",
    "vec3 llMaterialParityFresnel( const in vec3 f0, const in float dotVH ) {",
    "\tfloat fresnel = exp2( ( -5.55473 * dotVH - 6.98316 ) * dotVH );",
    "\treturn f0 * ( 1.0 - fresnel ) + vec3( fresnel );",
    "}",
    "vec3 llMaterialParityGgx( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 f0, const in float shininess ) {",
    "\tfloat roughness = llMaterialParityRoughness( shininess );",
    "\tfloat alpha = roughness * roughness;",
    "\tfloat alphaSquared = alpha * alpha;",
    "\tvec3 halfDir = normalize( lightDir + viewDir );",
    "\tfloat dotNL = clamp( dot( normal, lightDir ), 0.0, 1.0 );",
    "\tfloat dotNV = clamp( dot( normal, viewDir ), 0.0, 1.0 );",
    "\tfloat dotNH = clamp( dot( normal, halfDir ), 0.0, 1.0 );",
    "\tfloat dotVH = clamp( dot( viewDir, halfDir ), 0.0, 1.0 );",
    "\tfloat maskingView = dotNL * sqrt( alphaSquared + ( 1.0 - alphaSquared ) * dotNV * dotNV );",
    "\tfloat maskingLight = dotNV * sqrt( alphaSquared + ( 1.0 - alphaSquared ) * dotNL * dotNL );",
    "\tfloat visibility = 0.5 / max( maskingView + maskingLight, 1e-6 );",
    "\tfloat denominator = dotNH * dotNH * ( alphaSquared - 1.0 ) + 1.0;",
    "\tfloat distribution = 0.3183098861837907 * alphaSquared / ( denominator * denominator );",
    "\treturn llMaterialParityFresnel( f0, dotVH ) * ( visibility * distribution );",
    "}",
    "vec3 " + PARITY_FUNCTION_NAME + "( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {",
    "\tvec3 legacySpecular = BRDF_BlinnPhong( lightDir, viewDir, normal, specularColor, shininess );",
    "\tif ( " + PARITY_MIX_UNIFORM + " <= 0.0 ) return legacySpecular;",
    "\tvec3 f0 = mix( specularColor, vec3( " + PARITY_F0_UNIFORM + " ), " + PARITY_MIX_UNIFORM + " );",
    "\tvec3 paritySpecular = llMaterialParityGgx( lightDir, viewDir, normal, f0, shininess );",
    "\treturn mix( legacySpecular, paritySpecular, " + PARITY_MIX_UNIFORM + " );",
    "}",
  ].join("\n");
}

function countOccurrences(text, needle) {
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count++;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}



export function rewritePhongLightingChunk(chunkSource) {
  if (typeof chunkSource !== "string") return null;
  if (chunkSource.indexOf(PARITY_FUNCTION_NAME) >= 0) return null;
  if (countOccurrences(chunkSource, LEGACY_SPECULAR_CALL) !== 1) return null;
  return buildParityGlsl() + "\n" + chunkSource.replace(LEGACY_SPECULAR_CALL, PARITY_FUNCTION_NAME + "(");
}
