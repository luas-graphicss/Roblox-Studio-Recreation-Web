import {
  CS_EDGE_MARGIN,
  CS_MAX_STEPS,
  CS_MIN_HIT,
  CS_STEP_POW,
} from "../lighting/aoCore.js";

import { CF_LOCAL_NEAR_EPS } from "../lighting/contactFuseCore.js";


import { CONTACT_FADE_AT_FULL_REACH } from "../lighting/contactShadowFalloff.js";


export function glslFloat(v) {
  const s = String(v);
  return s.indexOf(".") >= 0 || s.indexOf("e") >= 0 ? s : s + ".0";
}

export function contactShadowGlsl() {
  return `
float rswEdgeFade(vec2 uv) {
  vec2 a = smoothstep(vec2(0.0), vec2(${glslFloat(CS_EDGE_MARGIN)}), uv);
  vec2 b = smoothstep(vec2(0.0), vec2(${glslFloat(CS_EDGE_MARGIN)}), vec2(1.0) - uv);
  return a.x * a.y * b.x * b.y;
}
                                                                            
                                                                           
                                                 
float rswContactFalloff(float marchFraction) {
  return 1.0 - ${glslFloat(CONTACT_FADE_AT_FULL_REACH)} * clamp(marchFraction, 0.0, 1.0);
}
float rswContactShadow(vec3 pc, float rnd) {
  vec3 dirV = normalize(uCsDir);
  float shadow = 1.0;
  for (int i = 0; i < ${CS_MAX_STEPS}; i++) {
    if (i >= uCsSteps) break;
    float f = pow((float(i) + rnd) / float(uCsSteps), ${glslFloat(CS_STEP_POW)});
    vec3 p = pc + dirV * (uCsDistance * f + ${glslFloat(CS_MIN_HIT)});
    if (p.z > -uNear) break;
    float pd = -p.z;
    vec2 suv = (p.xy / (pd * uInvProj)) * 0.5 + 0.5;
    if (suv.x <= 0.001 || suv.x >= 0.999 || suv.y <= 0.001 || suv.y >= 0.999) break;
    float diff = pd - rswDist(suv);
    if (diff > ${glslFloat(CS_MIN_HIT)} && diff < uCsThickness) {
      float fade = rswEdgeFade(suv) * rswContactFalloff(f);
      shadow = 1.0 - fade;
      break;
    }
  }
  return shadow;
}
`;
}




















export function contactLocalGlsl() {
  return `
float rswContactLocal(vec3 pc, float rnd) {
  vec3 toL = uCsLocalPos - pc;
  float dl = length(toL);
  if (dl <= ${glslFloat(CF_LOCAL_NEAR_EPS)} || uCsLocalRange <= ${glslFloat(CF_LOCAL_NEAR_EPS)}) return 1.0;
  float q2 = (dl * dl) / (uCsLocalRange * uCsLocalRange);
  float win = clamp(1.0 - q2 * q2, 0.0, 1.0);
  if (win <= 0.001) return 1.0;
  vec3 dirV = toL / dl;
  float maxT = min(dl - ${glslFloat(CF_LOCAL_NEAR_EPS)}, uCsDistance);
  if (maxT <= 0.0) return 1.0;
  float shadow = 1.0;
  for (int i = 0; i < ${CS_MAX_STEPS}; i++) {
    if (i >= uCsLocalSteps) break;
    float f = pow((float(i) + rnd) / float(uCsLocalSteps), ${glslFloat(CS_STEP_POW)});
    vec3 p = pc + dirV * (maxT * f + ${glslFloat(CS_MIN_HIT)});
    if (p.z > -uNear) break;
    float pd = -p.z;
    vec2 suv = (p.xy / (pd * uInvProj)) * 0.5 + 0.5;
    if (suv.x <= 0.001 || suv.x >= 0.999 || suv.y <= 0.001 || suv.y >= 0.999) break;
    float diff = pd - rswDist(suv);
    if (diff > ${glslFloat(CS_MIN_HIT)} && diff < uCsThickness) {
      float fade = rswEdgeFade(suv) * rswContactFalloff(f);
                                                                            
                                                                         
                                                                          
      float pen = 1.0 - clamp(uCsLocalSpread / (uCsLocalSpread + max(dl, 1e-4)), 0.0, 0.85);
      shadow = 1.0 - fade * win * win * pen;
      break;
    }
  }
  return shadow;
}
`;
}
