export const SA_ALPHA_MODES = Object.freeze(["Overlay", "Transparency", "TintMask"]);
export const SA_NORMAL_CONVENTIONS = Object.freeze(["Auto", "OpenGL", "DirectX"]);
export const SA_POM_MAX_STEPS = 16;
export const SA_POM_MIN_STEPS = 8;


export const SA_CHANNEL_CONTRACT = Object.freeze({
  colorMap: Object.freeze({ srgb: true, channels: "rgb=albedo, a=AlphaMode" }),
  normalMap: Object.freeze({ srgb: false, channels: "rg=xy (GL: +Y p/ cima; DX: Y invertido), b=z" }),
  ormPacked: Object.freeze({ srgb: false, channels: "r=AO, g=Roughness, b=Metalness (convenção glTF)" }),
  metalnessMap: Object.freeze({ srgb: false, channels: "b (three lê o canal AZUL)" }),
  roughnessMap: Object.freeze({ srgb: false, channels: "g (three lê o canal VERDE)" }),
  heightMap: Object.freeze({ srgb: false, channels: "r=altura (1=topo, 0=fundo)" }),
  detailColorMap: Object.freeze({ srgb: true, channels: "rgb=albedo de detalhe (neutro 0,5 — aplicado ×2)" }),
  detailNormalMap: Object.freeze({ srgb: false, channels: "rg=xy, b=z (blend UDN sobre a normal base)" }),
});

export function alphaModeIndex(mode) {
  const idx = SA_ALPHA_MODES.indexOf(String(mode || ""));
  return idx === -1 ? 0 : idx;
}


export function alphaModePlan(mode) {
  const index = alphaModeIndex(mode);
  return Object.freeze({ index, transparent: index === 1 });
}

export function isPackedOrm(metalnessMap, roughnessMap) {
  const m = String(metalnessMap || "");
  const r = String(roughnessMap || "");
  return !!m && m === r;
}

export function normalScaleYFor(convention) {
  return String(convention) === "DirectX" ? -1 : 1;
}

export function sanitizeDetailTiling(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(256, Math.max(0.05, n)) : 8;
}

export function sanitizePomScale(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(0.2, Math.max(0, n)) : 0.02;
}

export function sanitizePomSteps(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n)
    ? Math.min(SA_POM_MAX_STEPS, Math.max(SA_POM_MIN_STEPS, n))
    : 12;
}


export function pomEnabled(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  return !o.weakGpu && !!o.hasHeightMap && sanitizePomScale(o.heightScale) > 0.0005;
}


export function planSurfaceMaps(surface, opts = {}) {


  const s = surface && typeof surface === "object" ? surface : {};
  const o = opts && typeof opts === "object" ? opts : {};
  const has = (v) => typeof v === "string" && v.length > 0;
  const orm = isPackedOrm(s.metalnessMap, s.roughnessMap);
  const pom = pomEnabled({
    weakGpu: !!o.weakGpu,
    hasHeightMap: has(s.heightMap),
    heightScale: s.heightScale,
  });
  const maps = {
    color: has(s.colorMap) ? { id: s.colorMap, srgb: true } : null,
    normal: has(s.normalMap) ? { id: s.normalMap, srgb: false } : null,
    orm: orm ? { id: s.metalnessMap, srgb: false } : null,
    metalness: !orm && has(s.metalnessMap) ? { id: s.metalnessMap, srgb: false } : null,
    roughness: !orm && has(s.roughnessMap) ? { id: s.roughnessMap, srgb: false } : null,
    height: pom ? { id: s.heightMap, srgb: false } : null,


    detailColor: has(s.detailColorMap) && has(s.colorMap) ? { id: s.detailColorMap, srgb: true } : null,

    detailNormal: has(s.detailNormalMap) && has(s.normalMap)
      ? { id: s.detailNormalMap, srgb: false }
      : null,
  };
  const seen = new Set();
  for (const k of Object.keys(maps)) {
    if (maps[k]) seen.add(maps[k].id);
  }
  return {
    alpha: alphaModePlan(s.alphaMode),
    normalScaleY: normalScaleYFor(s.normalMapConvention),
    orm,
    maps,
    detailTiling: sanitizeDetailTiling(s.detailTiling),
    pom,
    pomScale: pom ? sanitizePomScale(s.heightScale) : 0,
    pomSteps: sanitizePomSteps(s.pomSteps),
    texUnits: seen.size,
  };
}


export function surfaceSignature(surface, opts = {}) {
  const s = surface && typeof surface === "object" ? surface : {};
  const p = planSurfaceMaps(s, opts);
  const c = s.color || {};
  const f = (v) => (Number.isFinite(v) ? v.toFixed(3) : "1");
  return [
    s.colorMap || "",
    s.normalMap || "",
    s.metalnessMap || "",
    s.roughnessMap || "",
    p.maps.height ? s.heightMap : "",
    p.maps.detailColor ? s.detailColorMap : "",
    p.maps.detailNormal ? s.detailNormalMap : "",
    "am" + p.alpha.index,
    "ny" + p.normalScaleY,
    p.orm ? "orm" : "sep",
    "dt" + p.detailTiling.toFixed(2),
    "ps" + p.pomScale.toFixed(4),
    f(c.r) + "," + f(c.g) + "," + f(c.b),
  ].join("|");
}


export function parallaxShiftJs(height, scale, vx, vy, vz) {
  const s = sanitizePomScale(scale);
  const z = Math.max(0.05, Number(vz) || 0);
  const h = Math.min(1, Math.max(0, Number(height) || 0));
  const d = 1 - h;
  return [(-(Number(vx) || 0) / z) * s * d, (-(Number(vy) || 0) / z) * s * d];
}

export function saDefines(flags) {
  const fl = flags && typeof flags === "object" ? flags : {};
  const d = {};
  if (fl.pom) d.RSW_SA_POM = "";
  if (fl.detailColor) d.RSW_SA_DETAIL_COLOR = "";
  if (fl.detailNormal) d.RSW_SA_DETAIL_NORMAL = "";
  return d;
}


export function saProgramKey(flags) {
  const fl = flags && typeof flags === "object" ? flags : {};
  return (
    "rswSaF10" +
    (fl.pom ? "|p" : "") +
    (fl.detailColor ? "|dc" : "") +
    (fl.detailNormal ? "|dn" : "")
  );
}


export const SA_GLSL_UNIFORMS = `
uniform float uSaAlphaMode;
#ifdef RSW_SA_POM
uniform sampler2D uSaHeightMap;
uniform float uSaPomScale;
uniform float uSaPomSteps;
#endif
#ifdef RSW_SA_DETAIL_COLOR
uniform sampler2D uSaDetailColor;
#endif
#ifdef RSW_SA_DETAIL_NORMAL
uniform sampler2D uSaDetailNormal;
#endif
#if defined( RSW_SA_DETAIL_COLOR ) || defined( RSW_SA_DETAIL_NORMAL )
uniform float uSaDetailTiling;
#endif
`;


export const SA_GLSL_PRELUDE = `
#ifdef USE_MAP
	vec2 saUvBase = vMapUv;
#elif defined( USE_NORMALMAP )
	vec2 saUvBase = vNormalMapUv;
#elif defined( USE_ROUGHNESSMAP )
	vec2 saUvBase = vRoughnessMapUv;
#elif defined( USE_METALNESSMAP )
	vec2 saUvBase = vMetalnessMapUv;
#else
	vec2 saUvBase = vec2( 0.0 );
#endif
vec2 saUv = saUvBase;
#if defined( RSW_SA_POM ) && ( defined( USE_MAP ) || defined( USE_NORMALMAP ) || defined( USE_ROUGHNESSMAP ) || defined( USE_METALNESSMAP ) )
if ( uSaPomScale > 0.0005 ) {
	vec3 saN = normalize( vNormal );
	vec3 saV = normalize( vViewPosition );
	vec3 saDp1 = dFdx( -vViewPosition );
	vec3 saDp2 = dFdy( -vViewPosition );
	vec2 saDuv1 = dFdx( saUvBase );
	vec2 saDuv2 = dFdy( saUvBase );
	vec3 saDp2p = cross( saDp2, saN );
	vec3 saDp1p = cross( saN, saDp1 );
	vec3 saT = saDp2p * saDuv1.x + saDp1p * saDuv2.x;
	vec3 saB = saDp2p * saDuv1.y + saDp1p * saDuv2.y;
	float saInv = inversesqrt( max( dot( saT, saT ), dot( saB, saB ) ) + 1e-12 );
	vec3 saVts = vec3( dot( saV, saT * saInv ), dot( saV, saB * saInv ), max( dot( saV, saN ), 0.0 ) );
	if ( saVts.z > 0.05 ) {
		float saLayer = 1.0 / uSaPomSteps;
		vec2 saDelta = ( saVts.xy / saVts.z ) * ( uSaPomScale / uSaPomSteps );
		float saDepth = 0.0;
		vec2 saCur = saUvBase;
		float saH = 1.0 - texture2D( uSaHeightMap, saCur ).r;
		for ( int i = 0; i < 16; i ++ ) {
			if ( saDepth >= saH || float( i ) >= uSaPomSteps ) break;
			saCur -= saDelta;
			saH = 1.0 - texture2D( uSaHeightMap, saCur ).r;
			saDepth += saLayer;
		}
		saUv = saCur;
	}
}
#endif
`;


export const SA_GLSL_MAP_CHUNK = `
#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, saUv );
	#ifdef RSW_SA_DETAIL_COLOR
	{
		vec3 saDet = texture2D( uSaDetailColor, saUv * uSaDetailTiling ).rgb;
		sampledDiffuseColor.rgb *= saDet * 2.0;
	}
	#endif
	if ( uSaAlphaMode < 0.5 ) {
		diffuseColor.rgb = mix( diffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a );
	} else if ( uSaAlphaMode < 1.5 ) {
		diffuseColor *= sampledDiffuseColor;
	} else {
		diffuseColor.rgb = sampledDiffuseColor.rgb * mix( vec3( 1.0 ), diffuse, sampledDiffuseColor.a );
	}
#endif
`;


export const SA_GLSL_NORMAL_CHUNK = `
#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, saUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, saUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	#ifdef RSW_SA_DETAIL_NORMAL
	{
		vec3 saDn = texture2D( uSaDetailNormal, saUv * uSaDetailTiling ).xyz * 2.0 - 1.0;
		                                                                              
		saDn.xy *= sign( normalScale );
		mapN = normalize( vec3( mapN.xy + saDn.xy, mapN.z ) );
	}
	#endif
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif
`;




export const SA_GLSL_ROUGHNESS_CHUNK = `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, saUv );
	roughnessFactor *= texelRoughness.g;
#endif
`;

export const SA_GLSL_METALNESS_CHUNK = `
float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, saUv );
	metalnessFactor *= texelMetalness.b;
#endif
`;
