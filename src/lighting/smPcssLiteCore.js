import {
  DEFAULT_SHADOW_SOFTNESS,
  SHARP_EDGE_MIN_TEXELS,
  SHARP_EDGE_MAX_TEXELS,
  softKernelPenumbraTexels,
} from "./shadowEdgeSharpness.js";

export const SM_LITE_RADIUS_MARKER = 5001;
export const SM_LITE_TAPS = 8;


export const SM_LITE_PEN_MIN = SHARP_EDGE_MIN_TEXELS;
export const SM_LITE_PEN_MAX = SHARP_EDGE_MAX_TEXELS;
export const SM_LITE_PEN_DEFAULT = softKernelPenumbraTexels(DEFAULT_SHADOW_SOFTNESS);


export const SM_LITE_GOLDEN_ANGLE = 2.399963;


export const SM_LITE_CH_SEARCH_TAPS = 4;
export const SM_LITE_CH_FLOOR_TEXELS = SHARP_EDGE_MIN_TEXELS;
export const SM_LITE_CH_GAIN = 14;


export function smLitePenumbraTexels(softness) {
  return softKernelPenumbraTexels(softness);
}


export function resolveSmLiteContactFlag(flag) {
  return flag !== false;
}


export function smPcssLitePlan(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const packageOn = a.packageOn === true;
  const supported = a.supported === true;
  const shadowsOn = a.shadowsOn !== false;
  const on = packageOn && supported && shadowsOn;
  const reason = on
    ? "on"
    : !packageOn
      ? "pacote-off"
      : !supported
        ? "chunk-incompativel"
        : "sombras-off";
  return Object.freeze({
    on,
    radius: on ? SM_LITE_RADIUS_MARKER : null,
    taps: SM_LITE_TAPS,
    reason,
  });
}


export function buildSmLiteGlsl() {
  const inv = (1 / SM_LITE_TAPS).toFixed(3);                         
  return (
    "\n" +
    "// SM-LITE F3/F7: PCSS-lite do sol no ShadowMap clássico — 8 taps Vogel.\n" +
    "// uRswSmLiteCH=0: penumbra CONSTANTE (F3). uRswSmLiteCH=1: contact\n" +
    "// hardening lite (F7) — mini-busca de 4 taps escala a penumbra do piso\n" +
    "// de contato ao teto do slider. IGN ESTÁTICO por pixel (zero cintilação\n" +
    "// própria; shimmer do mapa fica p/ o rodízio F6/F9).\n" +
    "uniform float uRswSmLitePen;\n" +
    "uniform float uRswSmLiteCH;\n" +
    "float rswSmLite(sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 sc) {\n" +
    "  vec3 rswC = sc.xyz / sc.w;\n" +
    "  rswC.z += shadowBias;\n" +


    "  float rswTexel = 1.0 / max(shadowMapSize.x, 1.0);\n" +
    "  vec3 rswDx = dFdx(rswC);\n" +
    "  vec3 rswDy = dFdy(rswC);\n" +
    "  float rswDet = rswDx.x * rswDy.y - rswDx.y * rswDy.x;\n" +
    "  vec2 rswDzDuv = vec2(0.0);\n" +
    "  if (abs(rswDet) > 1e-10) {\n" +
    "    rswDzDuv = vec2(rswDy.y * rswDx.z - rswDx.y * rswDy.z, rswDx.x * rswDy.z - rswDy.x * rswDx.z) / rswDet;\n" +
    "    rswDzDuv = rswTrustedReceiverPlane(rswDzDuv, rswTexel, rswPlaneBiasCap());\n" +
    "  }\n" +
    "  bvec4 rswInF = bvec4(rswC.x >= 0.0, rswC.x <= 1.0, rswC.y >= 0.0, rswC.y <= 1.0);\n" +
    "  if (!all(rswInF) || rswC.z > 1.0 || rswC.z < 0.0) return 1.0;\n" +
    "  float rswPenT = clamp(uRswSmLitePen, 1.0, 6.0);\n" +
    "  float rswRad = rswPenT * rswTexel;\n" +
    "  float rswAng = rswIgn(gl_FragCoord.xy) * PI2;\n" +


    "  if (uRswSmLiteCH > 0.5) {\n" +
    "    float rswBSum = 0.0;\n" +
    "    float rswBN = 0.0;\n" +
    "    for (int j = 0; j < " + SM_LITE_CH_SEARCH_TAPS + "; j++) {\n" +
    "      float rswBA = rswAng + 3.141593 + float(j) * " + SM_LITE_GOLDEN_ANGLE.toFixed(6) + ";\n" +
    "      float rswBR = rswRad * sqrt((float(j) + 0.5) * " + (1 / SM_LITE_CH_SEARCH_TAPS).toFixed(3) + ");\n" +
    "      vec2 rswBOff = vec2(cos(rswBA), sin(rswBA)) * rswBR;\n" +
    "      float rswBD = rswUnpackDepth(texture2D(shadowMap, rswC.xy + rswBOff));\n" +
    "      if (rswBD < rswC.z + rswPlaneBias(rswDzDuv, rswBOff)) { rswBSum += rswBD; rswBN += 1.0; }\n" +
    "    }\n" +
    "    float rswCh = rswBN > 0.5 ? clamp((rswC.z - rswBSum / rswBN) * " + SM_LITE_CH_GAIN.toFixed(1) + ", 0.0, 1.0) : 0.0;\n" +
    "    rswRad = mix(" + SM_LITE_CH_FLOOR_TEXELS.toFixed(1) + ", rswPenT, rswCh) * rswTexel;\n" +
    "  }\n" +
    "  float rswSum = 0.0;\n" +
    "  for (int i = 0; i < " + SM_LITE_TAPS + "; i++) {\n" +
    "    float rswA = rswAng + float(i) * " + SM_LITE_GOLDEN_ANGLE.toFixed(6) + ";\n" +
    "    float rswR = rswRad * sqrt((float(i) + 0.5) * " + inv + ");\n" +
    "    vec2 rswOff = vec2(cos(rswA), sin(rswA)) * rswR;\n" +
    "    float rswZ = rswC.z + rswPlaneBias(rswDzDuv, rswOff);\n" +
    "    if (rswZ <= rswUnpackDepth(texture2D(shadowMap, rswC.xy + rswOff))) rswSum += 1.0;\n" +
    "  }\n" +
    "  return rswSum * " + inv + ";\n" +
    "}\n"
  );
}


export function buildSmLiteReturn() {
  const lo = (SM_LITE_RADIUS_MARKER - 1.5).toFixed(1);
  const hi = (SM_LITE_RADIUS_MARKER + 998.5).toFixed(1);
  return (
    "\n" +
    "  // SM-LITE F3/F7: marcador " + SM_LITE_RADIUS_MARKER + " => Vogel-" + SM_LITE_TAPS + " (CH=0 constante / CH=1 contato).\n" +
    "  if (shadowRadius > " + lo + " && shadowRadius < " + hi + ") {\n" +
    "    return rswSmLite(shadowMap, shadowMapSize, shadowBias, shadowCoord);\n" +
    "  }\n"
  );
}
