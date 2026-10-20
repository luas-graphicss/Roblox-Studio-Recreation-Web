import { SA_META_TEX_W, buildAtlasGlsl } from "./shadowAtlasCore.js";

export const ATLAS_ON_UNIFORM = "uAtlasOn";
export const LEGACY_SPOT_SHADOW_COUNT_UNIFORM = "uLlAtlasSpotShadowCount";
export const ATLAS_DECLARATION_MARKER = "uniform sampler2D uAtlasTex";


const ATLAS_UNPACK_SHIM_GLSL = [
  "// LL-F10: rswUnpack e o gancho que o texto da engine espera do frag",
  "// hospedeiro. Aqui ele le o formato do packDepthToRGBA do three.",
  "const vec4 LL_ATLAS_UNPACK_FACTORS = ( 255.0 / 256.0 ) / vec4( 256.0 * 256.0 * 256.0, 256.0 * 256.0, 256.0, 1.0 );",
  "float rswUnpack( const in vec4 packedDepth ) {",
  "  return dot( packedDepth, LL_ATLAS_UNPACK_FACTORS );",
  "}",
].join("\n");


const ATLAS_DISPATCHERS_GLSL = [
  "// ── LL-F10: despachantes do atlas nos call sites do three ──",
  "uniform float " + LEGACY_SPOT_SHADOW_COUNT_UNIFORM + "; // spots que ainda tem mapa avulso",
  "float llAtlasSpotShadow( const in float spotIndex, const in vec3 viewPosition, const in float legacyShadow ) {",
  "  if ( " + ATLAS_ON_UNIFORM + " <= 0.0 ) return legacyShadow;",
  "  float atlasVisibility = rswSaVis( spotIndex, viewPosition );",
  "  return atlasVisibility < 0.0 ? legacyShadow : atlasVisibility;",
  "}",
  "float llAtlasSpotShadowBeyondLegacyBudget( const in float spotIndex, const in vec3 viewPosition ) {",
  "  if ( " + ATLAS_ON_UNIFORM + " <= 0.0 ) return 1.0;",
  "  if ( spotIndex < " + LEGACY_SPOT_SHADOW_COUNT_UNIFORM + " ) return 1.0;",
  "  float atlasVisibility = rswSaVis( spotIndex, viewPosition );",
  "  return atlasVisibility < 0.0 ? 1.0 : atlasVisibility;",
  "}",
].join("\n");



export function buildAtlasFragmentDeclarations() {
  return [ATLAS_UNPACK_SHIM_GLSL, buildAtlasGlsl(SA_META_TEX_W), ATLAS_DISPATCHERS_GLSL].join("\n");
}


export const SPOT_BLOCK_OPEN = "#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )";
export const UNROLL_LOOP_END = "#pragma unroll_loop_end";
export const LEGACY_SPOT_SHADOW_CALL =
  "getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] )";
export const SPOT_RE_DIRECT_CALL =
  "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";

export const REWRITE_REFUSAL = Object.freeze({
  spotBlockNotFound: "spot-block-not-found",
  alreadyRewritten: "already-rewritten",
  shadowCallNotUnique: "shadow-call-not-unique",
  reDirectCallNotUnique: "re-direct-call-not-unique",
});




export const ATLAS_SPOT_SHADOW_FUNCTION = "llAtlasSpotShadow";
export const ATLAS_BEYOND_BUDGET_FUNCTION = "llAtlasSpotShadowBeyondLegacyBudget";




const SPOT_INDEX_EXPRESSION = "float( UNROLLED_LOOP_INDEX )";



const VIEW_POSITION_EXPRESSION = "geometryPosition";

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let cursor = haystack.indexOf(needle);
  while (cursor !== -1) {
    count++;
    cursor = haystack.indexOf(needle, cursor + needle.length);
  }
  return count;
}

function refuseRewrite(source, refusal) {
  return Object.freeze({ ok: false, source, rewrites: 0, refusal });
}


function findSpotLightBlock(source) {
  const openAt = source.indexOf(SPOT_BLOCK_OPEN);
  if (openAt === -1) return null;
  const closeAt = source.indexOf(UNROLL_LOOP_END, openAt);
  if (closeAt === -1) return null;
  return { openAt, closeAt: closeAt + UNROLL_LOOP_END.length };
}


export function rewriteSpotLightBlock(source) {
  const text = typeof source === "string" ? source : "";
  const block = findSpotLightBlock(text);
  if (!block) return refuseRewrite(text, REWRITE_REFUSAL.spotBlockNotFound);

  const head = text.slice(0, block.openAt);
  const spotBlock = text.slice(block.openAt, block.closeAt);
  const tail = text.slice(block.closeAt);

  if (spotBlock.includes(ATLAS_SPOT_SHADOW_FUNCTION)) {
    return refuseRewrite(text, REWRITE_REFUSAL.alreadyRewritten);
  }
  if (countOccurrences(spotBlock, LEGACY_SPOT_SHADOW_CALL) !== 1) {
    return refuseRewrite(text, REWRITE_REFUSAL.shadowCallNotUnique);
  }
  if (countOccurrences(spotBlock, SPOT_RE_DIRECT_CALL) !== 1) {
    return refuseRewrite(text, REWRITE_REFUSAL.reDirectCallNotUnique);
  }


  const atlasFirstShadow =
    ATLAS_SPOT_SHADOW_FUNCTION +
    "( " + SPOT_INDEX_EXPRESSION + ", " + VIEW_POSITION_EXPRESSION + ", " + LEGACY_SPOT_SHADOW_CALL + " )";


  const beyondBudgetShadow =
    "directLight.color *= " + ATLAS_BEYOND_BUDGET_FUNCTION +
    "( " + SPOT_INDEX_EXPRESSION + ", " + VIEW_POSITION_EXPRESSION + " );";

  const rewrittenBlock = spotBlock
    .replace(LEGACY_SPOT_SHADOW_CALL, () => atlasFirstShadow)
    .replace(SPOT_RE_DIRECT_CALL, () => beyondBudgetShadow + "\n\n\t\t" + SPOT_RE_DIRECT_CALL);

  return Object.freeze({ ok: true, source: head + rewrittenBlock + tail, rewrites: 2, refusal: null });
}


const PACK_UPSCALE = 256 / 255;
const UNPACK_DOWNSCALE = 255 / 256;
const SHIFT_RIGHT_8 = 1 / 256;
const PACK_FACTORS = [256 * 256 * 256, 256 * 256, 256];

function fractionalPart(value) {
  return value - Math.floor(value);
}

export function packDepthToRgba8(depth) {
  const packed = [
    fractionalPart(depth * PACK_FACTORS[0]),
    fractionalPart(depth * PACK_FACTORS[1]),
    fractionalPart(depth * PACK_FACTORS[2]),
    depth,
  ];


  const overflow = [packed[0] * SHIFT_RIGHT_8, packed[1] * SHIFT_RIGHT_8, packed[2] * SHIFT_RIGHT_8];
  packed[1] -= overflow[0];
  packed[2] -= overflow[1];
  packed[3] -= overflow[2];
  return packed.map((channel) => channel * PACK_UPSCALE);
}

export function unpackRgba8ToDepth(packed) {
  const rgba = Array.isArray(packed) ? packed : [0, 0, 0, 0];
  return (
    UNPACK_DOWNSCALE *
    ((Number(rgba[0]) || 0) / PACK_FACTORS[0] +
      (Number(rgba[1]) || 0) / PACK_FACTORS[1] +
      (Number(rgba[2]) || 0) / PACK_FACTORS[2] +
      (Number(rgba[3]) || 0))
  );
}
