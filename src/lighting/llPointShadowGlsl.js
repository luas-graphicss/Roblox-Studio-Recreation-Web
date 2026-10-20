import {
  POINT_ATLAS_FIRST_META_ROW_UNIFORM,
  POINT_ATLAS_LIGHT_COUNT_UNIFORM,
  POINT_ATLAS_ON_UNIFORM,
  POINT_LEGACY_SHADOW_COUNT_UNIFORM,
} from "./llPointShadowContract.js";
import { CUBE_FACE_COUNT } from "./llPointShadowCore.js";

export const POINT_BLOCK_OPEN = "#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )";
export const UNROLL_LOOP_END = "#pragma unroll_loop_end";
export const LEGACY_POINT_SHADOW_CALL_PREFIX = "getPointShadow(";


export const RE_DIRECT_CALL =
  "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";

export const ATLAS_POINT_SHADOW_FUNCTION = "llPointAtlasShadow";
export const ATLAS_POINT_BEYOND_BUDGET_FUNCTION = "llPointAtlasShadowBeyondLegacyBudget";


export const POINT_DISPATCHER_MARKER = "float llPointAtlasShadow(";


export const POINT_REWRITE_REFUSAL = Object.freeze({
  pointBlockNotFound: "pointBlockNotFound",
  unrollEndNotFound: "unrollEndNotFound",
  alreadyRewritten: "alreadyRewritten",
  legacyShadowCallNotUnique: "legacyShadowCallNotUnique",
  reDirectCallNotUnique: "reDirectCallNotUnique",
});


export function findBalancedCall(text, callPrefix) {
  const source = String(text || "");
  const prefix = String(callPrefix || "");
  const start = source.indexOf(prefix);
  if (start < 0 || prefix.length === 0) return null;
  let depth = 0;
  for (let i = start + prefix.length - 1; i < source.length; i++) {
    const character = source[i];
    if (character === "(") depth++;
    else if (character === ")") {
      depth--;
      if (depth === 0) {
        return { start: start, end: i + 1, text: source.slice(start, i + 1) };
      }
    }
  }
  return null;
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return count;
    count++;
    from = at + needle.length;
  }
}


export function buildPointDispatcherGlsl() {
  const faceCount = CUBE_FACE_COUNT.toFixed(1);
  return [
    "// -- LL-F11: point light shadow read from the atlas (6 cube faces) --",
    "uniform float " + POINT_ATLAS_ON_UNIFORM + ";                 // 0 = legacy cubemap path",
    "uniform float " + POINT_ATLAS_FIRST_META_ROW_UNIFORM + ";      // first reserved meta row (64)",
    "uniform float " + POINT_ATLAS_LIGHT_COUNT_UNIFORM + ";         // point lights that own cube pages",
    "uniform float " + POINT_LEGACY_SHADOW_COUNT_UNIFORM + ";       // point lights that still own a cubemap",
    "// Face order mirrors CUBE_FACE_IDS in llPointShadowCore.js: +X -X +Y -Y +Z -Z.",
    "float llPointCubeFaceIndex( const in vec3 directionWorld ) {",
    "  vec3 a = abs( directionWorld );",
    "  if ( a.x >= a.y && a.x >= a.z ) return directionWorld.x > 0.0 ? 0.0 : 1.0;",
    "  if ( a.y >= a.z ) return directionWorld.y > 0.0 ? 2.0 : 3.0;",
    "  return directionWorld.z > 0.0 ? 4.0 : 5.0;",
    "}",
    "// -1 = this light has no page in the atlas (caller keeps the legacy value).",
    "float llPointAtlasVisibility( const in float pointIndex, const in vec3 viewPosition, const in vec3 lightViewPosition ) {",
    "  if ( pointIndex >= " + POINT_ATLAS_LIGHT_COUNT_UNIFORM + " ) return -1.0;",
    "  vec3 fromLightView = viewPosition - lightViewPosition;",
    "  vec3 fromLightWorld = mat3( uCamWorld ) * fromLightView;",
    "  float faceIndex = llPointCubeFaceIndex( fromLightWorld );",
    "  float metaRow = " + POINT_ATLAS_FIRST_META_ROW_UNIFORM + " + pointIndex * " + faceCount + " + faceIndex;",
    "  return rswSaVis( metaRow, viewPosition );",
    "}",
    "float " + ATLAS_POINT_SHADOW_FUNCTION + "( const in float pointIndex, const in vec3 viewPosition, const in vec3 lightViewPosition, const in float legacyShadow ) {",
    "  if ( " + POINT_ATLAS_ON_UNIFORM + " <= 0.0 ) return legacyShadow;",
    "  float visibility = llPointAtlasVisibility( pointIndex, viewPosition, lightViewPosition );",
    "  return visibility < 0.0 ? legacyShadow : visibility;",
    "}",
    "float " + ATLAS_POINT_BEYOND_BUDGET_FUNCTION + "( const in float pointIndex, const in vec3 viewPosition, const in vec3 lightViewPosition ) {",
    "  if ( " + POINT_ATLAS_ON_UNIFORM + " <= 0.0 ) return 1.0;",
    "  if ( pointIndex < " + POINT_LEGACY_SHADOW_COUNT_UNIFORM + " ) return 1.0;",
    "  float visibility = llPointAtlasVisibility( pointIndex, viewPosition, lightViewPosition );",
    "  return visibility < 0.0 ? 1.0 : visibility;",
    "}",
  ].join("\n");
}

function refuse(reason) {
  return Object.freeze({ ok: false, reason: reason, source: null, rewrites: 0 });
}









export function rewritePointLightBlock(source) {
  const text = String(source || "");
  const openIndex = text.indexOf(POINT_BLOCK_OPEN);
  if (openIndex < 0) return refuse(POINT_REWRITE_REFUSAL.pointBlockNotFound);
  const unrollIndex = text.indexOf(UNROLL_LOOP_END, openIndex);
  if (unrollIndex < 0) return refuse(POINT_REWRITE_REFUSAL.unrollEndNotFound);

  const blockEnd = unrollIndex + UNROLL_LOOP_END.length;
  let block = text.slice(openIndex, blockEnd);
  if (block.indexOf(POINT_DISPATCHER_MARKER) >= 0 || block.indexOf(ATLAS_POINT_SHADOW_FUNCTION + "(") >= 0) {
    return refuse(POINT_REWRITE_REFUSAL.alreadyRewritten);
  }

  let rewrites = 0;
  let legacyShadowCall = "";


  const legacyOccurrences = countOccurrences(block, LEGACY_POINT_SHADOW_CALL_PREFIX);
  if (legacyOccurrences > 1) return refuse(POINT_REWRITE_REFUSAL.legacyShadowCallNotUnique);
  if (legacyOccurrences === 1) {
    const legacy = findBalancedCall(block, LEGACY_POINT_SHADOW_CALL_PREFIX);
    if (!legacy) return refuse(POINT_REWRITE_REFUSAL.legacyShadowCallNotUnique);
    legacyShadowCall = legacy.text;
    const wrapped =
      ATLAS_POINT_SHADOW_FUNCTION +
      "( float( UNROLLED_LOOP_INDEX ), geometryPosition, pointLight.position, " +
      legacy.text +
      " )";
    block = block.slice(0, legacy.start) + wrapped + block.slice(legacy.end);
    rewrites++;
  }


  if (countOccurrences(block, RE_DIRECT_CALL) !== 1) {
    return refuse(POINT_REWRITE_REFUSAL.reDirectCallNotUnique);
  }
  const beyondBudgetLine =
    "directLight.color *= " +
    ATLAS_POINT_BEYOND_BUDGET_FUNCTION +
    "( float( UNROLLED_LOOP_INDEX ), geometryPosition, pointLight.position );\n\t\t";
  block = block.replace(RE_DIRECT_CALL, beyondBudgetLine + RE_DIRECT_CALL);
  rewrites++;

  return Object.freeze({
    ok: true,
    source: text.slice(0, openIndex) + block + text.slice(blockEnd),
    rewrites: rewrites,
    legacyShadowCall: legacyShadowCall,
  });
}
