import {
  CONTACT_SHADOW_DEPTH_UNIFORM,
  CONTACT_SHADOW_LIGHT_SLOTS,
  CONTACT_SHADOW_MARCH_UNIFORM,
  CONTACT_SHADOW_PARAMS_UNIFORM,
  CONTACT_SHADOW_POINT_LENGTH_UNIFORM,
  CONTACT_SHADOW_PROJECTION_UNIFORM,
  CONTACT_SHADOW_SPOT_LENGTH_UNIFORM,
} from "./llContactShadowContract.js";
import {
  CONTACT_SHADOW_MAX_STEPS,
  CONTACT_SHADOW_MIN_STEPS,
  CONTACT_SHADOW_NOISE_SCALE,
  CONTACT_SHADOW_NOISE_X,
  CONTACT_SHADOW_NOISE_Y,
} from "./llContactShadowCore.js";

export const CONTACT_SHADOW_FACTOR_FUNCTION = "llContactShadowFactor";
export const CONTACT_SHADOW_DECLARATIONS_MARKER = "uniform sampler2D " + CONTACT_SHADOW_DEPTH_UNIFORM + ";";
export const CONTACT_SHADOW_CALL_MARKER = CONTACT_SHADOW_FACTOR_FUNCTION + "( geometryPosition";
export const RE_DIRECT_CALL_SIGNATURE = "RE_Direct( directLight,";


export const CONTACT_SHADOW_LIGHT_LOOPS = Object.freeze([
  Object.freeze({ kind: "point", countToken: "NUM_POINT_LIGHTS", uniformName: CONTACT_SHADOW_POINT_LENGTH_UNIFORM }),
  Object.freeze({ kind: "spot", countToken: "NUM_SPOT_LIGHTS", uniformName: CONTACT_SHADOW_SPOT_LENGTH_UNIFORM }),
  Object.freeze({ kind: "directional", countToken: "NUM_DIR_LIGHTS", uniformName: null }),
  Object.freeze({ kind: "rectArea", countToken: "NUM_RECT_AREA_LIGHTS", uniformName: null }),
]);







export function buildContactShadowDeclarationsGlsl(options) {







  const settings = options && typeof options === "object" ? options : {};
  const decodeDepth =
    typeof settings.decodeDepth === "function" ? settings.decodeDepth : (depthFetch) => depthFetch + ".x";
  return [
    "// LL-F15 contact shadows (bancada luzes locais)",
    "uniform sampler2D " + CONTACT_SHADOW_DEPTH_UNIFORM + ";",
    "uniform vec4 " + CONTACT_SHADOW_PARAMS_UNIFORM + ";",
    "uniform vec4 " + CONTACT_SHADOW_PROJECTION_UNIFORM + ";",
    "uniform vec2 " + CONTACT_SHADOW_MARCH_UNIFORM + ";",
    "uniform float " + CONTACT_SHADOW_POINT_LENGTH_UNIFORM + "[ " + CONTACT_SHADOW_LIGHT_SLOTS + " ];",
    "uniform float " + CONTACT_SHADOW_SPOT_LENGTH_UNIFORM + "[ " + CONTACT_SHADOW_LIGHT_SLOTS + " ];",
    "",
    "float llContactShadowJitter( const in vec2 pixel, const in float phase ) {",
    "\treturn fract( fract( " + CONTACT_SHADOW_NOISE_SCALE + " * fract( dot( pixel, vec2( " + CONTACT_SHADOW_NOISE_X + ", " + CONTACT_SHADOW_NOISE_Y + " ) ) ) ) + phase );",
    "}",
    "",
    "float llContactShadowViewZ( const in float windowDepth ) {",
    "\tfloat near = " + CONTACT_SHADOW_PROJECTION_UNIFORM + ".z;",
    "\tfloat far = " + CONTACT_SHADOW_PROJECTION_UNIFORM + ".w;",
    "\treturn ( near * far ) / ( ( far - near ) * windowDepth - far );",
    "}",
    "",
    "vec2 llContactShadowViewToUv( const in vec3 viewPosition ) {",
    "\tfloat inverseW = 1.0 / max( -viewPosition.z, 0.0001 );",
    "\tvec2 normalizedDevice = vec2( viewPosition.x * " + CONTACT_SHADOW_PROJECTION_UNIFORM + ".x, viewPosition.y * " + CONTACT_SHADOW_PROJECTION_UNIFORM + ".y ) * inverseW;",
    "\treturn normalizedDevice * 0.5 + 0.5;",
    "}",
    "",
    "float " + CONTACT_SHADOW_FACTOR_FUNCTION + "( const in vec3 surfaceViewPosition, const in vec3 surfaceViewNormal, const in vec3 lightDirection, const in float marchLengthStuds ) {",
    "\tfloat intensity = " + CONTACT_SHADOW_PARAMS_UNIFORM + ".x;",
    "\tif ( intensity <= 0.0 || marchLengthStuds <= 0.0 ) return 1.0;",
    "\tfloat stepCount = clamp( " + CONTACT_SHADOW_PARAMS_UNIFORM + ".y, " + CONTACT_SHADOW_MIN_STEPS + ".0, " + CONTACT_SHADOW_MAX_STEPS + ".0 );",
    "\tfloat thickness = " + CONTACT_SHADOW_PARAMS_UNIFORM + ".z;",
    "\tfloat depthBias = " + CONTACT_SHADOW_MARCH_UNIFORM + ".x;",
    "\tfloat normalOffset = " + CONTACT_SHADOW_MARCH_UNIFORM + ".y;",
    "\tfloat jitter = llContactShadowJitter( gl_FragCoord.xy, " + CONTACT_SHADOW_PARAMS_UNIFORM + ".w );",
    "\tfloat stepLength = marchLengthStuds / stepCount;",
    "\tvec3 rayOrigin = surfaceViewPosition + surfaceViewNormal * normalOffset;",
    "\tfloat occlusion = 0.0;",
    "\tfor ( int marchIndex = 0; marchIndex < " + CONTACT_SHADOW_MAX_STEPS + "; marchIndex ++ ) {",
    "\t\tif ( float( marchIndex ) >= stepCount ) break;",
    "\t\tvec3 samplePosition = rayOrigin + lightDirection * ( ( float( marchIndex ) + jitter ) * stepLength );",
    "\t\tif ( samplePosition.z >= -" + CONTACT_SHADOW_PROJECTION_UNIFORM + ".z ) continue;",
    "\t\tvec2 sampleUv = llContactShadowViewToUv( samplePosition );",
    "\t\tif ( sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0 ) continue;",
    "\t\tfloat windowDepth = " + decodeDepth("texture2D( " + CONTACT_SHADOW_DEPTH_UNIFORM + ", sampleUv )") + ";",
    "\t\tif ( windowDepth >= 1.0 ) continue;",
    "\t\tfloat difference = llContactShadowViewZ( windowDepth ) - samplePosition.z;",
    "\t\tif ( difference > depthBias && difference < thickness ) {",
    "\t\t\tocclusion = 1.0;",
    "\t\t\tbreak;",
    "\t\t}",
    "\t}",
    "\treturn 1.0 - occlusion * intensity;",
    "}",
    "",
  ].join("\n");
}

function findAllOccurrences(text, needle) {
  const positions = [];
  let cursor = text.indexOf(needle);
  while (cursor >= 0) {
    positions.push(cursor);
    cursor = text.indexOf(needle, cursor + needle.length);
  }
  return positions;
}



export function lightLoopKindBefore(text, position) {
  let nearest = { kind: "unknown", index: -1 };
  CONTACT_SHADOW_LIGHT_LOOPS.forEach((loop) => {
    const index = text.lastIndexOf(loop.countToken, position);
    if (index > nearest.index) nearest = { kind: loop.kind, index };
  });
  return nearest.kind;
}






function buildLoopInjection(loop) {
  return (
    "#if " + loop.countToken + " <= " + CONTACT_SHADOW_LIGHT_SLOTS + "\n" +
    "\t\tdirectLight.color *= " + CONTACT_SHADOW_FACTOR_FUNCTION + "( geometryPosition, geometryNormal, directLight.direction, " + loop.uniformName + "[ i ] );\n" +
    "\t\t#endif\n" +
    "\t\t"
  );
}

export function injectContactShadowIntoLocalLightLoops(source) {
  const text = typeof source === "string" ? source : "";
  const nothingDone = (reason) => Object.freeze({ source: text, replaced: false, reason, patchedKinds: Object.freeze([]) });
  if (!text) return nothingDone("fonte vazia");
  if (text.indexOf(CONTACT_SHADOW_CALL_MARKER) >= 0) return nothingDone("ja injetado");
  const callPositions = findAllOccurrences(text, RE_DIRECT_CALL_SIGNATURE);
  if (!callPositions.length) return nothingDone("assinatura " + RE_DIRECT_CALL_SIGNATURE + " nao encontrada");

  const patchedKinds = [];
  let patched = text;

  for (let index = callPositions.length - 1; index >= 0; index--) {
    const position = callPositions[index];
    const kind = lightLoopKindBefore(text, position);
    const loop = CONTACT_SHADOW_LIGHT_LOOPS.find((item) => item.kind === kind && item.uniformName);
    if (!loop || patchedKinds.indexOf(kind) >= 0) continue;
    patched = patched.slice(0, position) + buildLoopInjection(loop) + patched.slice(position);
    patchedKinds.push(kind);
  }
  if (!patchedKinds.length) return nothingDone("nenhum laco de luz local encontrado");
  return Object.freeze({
    source: patched,
    replaced: true,
    reason: "",
    patchedKinds: Object.freeze(patchedKinds.slice().reverse()),
  });
}
