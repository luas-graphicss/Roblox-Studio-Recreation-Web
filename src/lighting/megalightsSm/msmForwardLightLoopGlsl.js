import { MSM_ALL_NATIVE_LIGHT_SEGMENTS, MSM_NATIVE_LIGHT_SEGMENTS } from "./msmForwardLightSegmentsCore.js";

export const MSM_FORWARD_LIGHT_LOOP_REVISION = "native-mask-1";

const LIGHT_LOOP_PATTERN = /(#pragma\s+unroll_loop_start\s+for\s*\(\s*int\s+(\w+)\s*=\s*0\s*;\s*\2\s*<\s*(NUM_POINT_LIGHTS|NUM_SPOT_LIGHTS)\s*;\s*\2\s*\+\+\s*\)\s*\{)([\s\S]*?)(\}\s*#pragma\s+unroll_loop_end)/g;
const LIGHT_CHUNK_PATTERN = /#include\s*<lights_fragment_begin>/g;
const LIGHT_LOOP_LAYOUT = Object.freeze({
  NUM_POINT_LIGHTS: { samplerPrefix: "NUM_POINT_LIGHT_SHADOWS", samplerBit: MSM_NATIVE_LIGHT_SEGMENTS.pointSampler, directBit: MSM_NATIVE_LIGHT_SEGMENTS.pointDirect },
  NUM_SPOT_LIGHTS: { samplerPrefix: "NUM_SPOT_LIGHT_COORDS", samplerBit: MSM_NATIVE_LIGHT_SEGMENTS.spotSampler, directBit: MSM_NATIVE_LIGHT_SEGMENTS.spotDirect },
});

const STOCK_LIGHT_LOOP_BODIES = Object.freeze({
  "NUM_POINT_LIGHTS": "pointLight = pointLights[ i ]; getPointLightInfo( pointLight, geometryPosition, directLight ); #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) pointLightShadow = pointLightShadows[ i ]; directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0; #endif RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );",
  "NUM_SPOT_LIGHTS": "spotLight = spotLights[ i ]; getSpotLightInfo( spotLight, geometryPosition, directLight ); #if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS ) #define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX #elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS ) #define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS #else #define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS ) #endif #if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS ) spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w; inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) ); spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy ); directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color; #endif #undef SPOT_LIGHT_MAP_INDEX #if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS ) spotLightShadow = spotLightShadows[ i ]; directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0; #endif RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );"
});

function compactSource(source) {
  return source.replace(/\s+/g, " ").trim();
}

function rewriteLightLoops(source, canonicalBodies, nativeLightMask) {
  let guardedLoopCount = 0;
  const rewritten = source.replace(LIGHT_LOOP_PATTERN, (loop, opening, index, count, body, closing) => {
    if (compactSource(body) !== canonicalBodies.get(count) || canonicalBodies.get(count) !== STOCK_LIGHT_LOOP_BODIES[count]) return loop;
    const layout = LIGHT_LOOP_LAYOUT[count];
    const samplerLoop = opening.replace(count, layout.samplerPrefix) + body + closing;
    const directOpening = opening.replace(/(int\s+\w+\s*=\s*)0/, "$1" + layout.samplerPrefix);
    const directLoop = directOpening + body + closing;
    if ((nativeLightMask & layout.samplerBit) && (nativeLightMask & layout.directBit)) return loop;
    guardedLoopCount += 1;
    return ((nativeLightMask & layout.samplerBit) ? samplerLoop : "") + "\n\n" +
      ((nativeLightMask & layout.directBit) ? directLoop : "");
  });
  return { source: rewritten, guardedLoopCount };
}

export function guardMsmForwardLightLoops(fragmentShader, shaderChunks = {}, nativeLightMask = MSM_ALL_NATIVE_LIGHT_SEGMENTS) {
  const canonicalChunk = shaderChunks.lights_fragment_begin;
  if (typeof fragmentShader !== "string" || typeof canonicalChunk !== "string" || !Number.isInteger(nativeLightMask) || nativeLightMask < 0 || nativeLightMask >= MSM_ALL_NATIVE_LIGHT_SEGMENTS) {
    return { source: fragmentShader, guardedLoopCount: 0 };
  }
  const canonicalBodies = new Map();
  for (const match of canonicalChunk.matchAll(LIGHT_LOOP_PATTERN)) canonicalBodies.set(match[3], compactSource(match[4]));
  let guardedLoopCount = 0;
  const expanded = fragmentShader.replace(LIGHT_CHUNK_PATTERN, () => {
    const result = rewriteLightLoops(canonicalChunk, canonicalBodies, nativeLightMask);
    guardedLoopCount += result.guardedLoopCount;
    return result.source;
  });
  const result = rewriteLightLoops(expanded, canonicalBodies, nativeLightMask);
  guardedLoopCount += result.guardedLoopCount;
  return { source: result.source, guardedLoopCount };
}
