import { MAX_ACTIVE_LOOKS } from "./lookBlend.js";

function createSampler(slot, backend) {
  const fetchValue = backend === "3d" ? `return texture(uLut${slot}, (coordinate + 0.5) / uSize${slot}).rgb;` : `vec2 tile = vec2(mod(coordinate.z, uLayout${slot}.x), floor(coordinate.z / uLayout${slot}.x));
  vec2 pixel = tile * uSize${slot} + coordinate.xy;
  return texture2D(uLut${slot}, (pixel + 0.5) / uLayout${slot}.yz).rgb;`;
  return `
uniform ${backend === "3d" ? "sampler3D" : "sampler2D"} uLut${slot};
uniform vec3 uDomainMin${slot};
uniform vec3 uDomainMax${slot};
uniform vec3 uLayout${slot};
uniform float uSize${slot};
uniform int uInterpolation${slot};
uniform int uClamp${slot};
vec3 readLut${slot}(vec3 coordinate) {
  ${fetchValue}
}
vec3 sampleLut${slot}(vec3 color) {
  vec3 normalized = (color - uDomainMin${slot}) / (uDomainMax${slot} - uDomainMin${slot});
  if (uClamp${slot} == 1) normalized = clamp(normalized, 0.0, 1.0);
  vec3 grid = normalized * (uSize${slot} - 1.0);
  vec3 base = clamp(floor(grid), vec3(0.0), vec3(uSize${slot} - 2.0));
  vec3 fraction = grid - base;
  vec3 origin = readLut${slot}(base);
  if (uInterpolation${slot} == 1) {
    vec3 firstStep;
    vec3 secondStep;
    vec3 weights;
    if (fraction.x >= fraction.y) {
      if (fraction.y >= fraction.z) { firstStep = vec3(1,0,0); secondStep = vec3(1,1,0); weights = fraction.xyz; }
      else if (fraction.x >= fraction.z) { firstStep = vec3(1,0,0); secondStep = vec3(1,0,1); weights = fraction.xzy; }
      else { firstStep = vec3(0,0,1); secondStep = vec3(1,0,1); weights = fraction.zxy; }
    } else {
      if (fraction.x >= fraction.z) { firstStep = vec3(0,1,0); secondStep = vec3(1,1,0); weights = fraction.yxz; }
      else if (fraction.y >= fraction.z) { firstStep = vec3(0,1,0); secondStep = vec3(0,1,1); weights = fraction.yzx; }
      else { firstStep = vec3(0,0,1); secondStep = vec3(0,1,1); weights = fraction.zyx; }
    }
    vec3 first = readLut${slot}(base + firstStep);
    vec3 second = readLut${slot}(base + secondStep);
    vec3 opposite = readLut${slot}(base + vec3(1.0));
    return origin + weights.x * (first - origin) + weights.y * (second - first) + weights.z * (opposite - second);
  }
  vec3 lowerFront = stableLerp(origin, readLut${slot}(base + vec3(1,0,0)), fraction.x);
  vec3 upperFront = stableLerp(readLut${slot}(base + vec3(0,1,0)), readLut${slot}(base + vec3(1,1,0)), fraction.x);
  vec3 lowerBack = stableLerp(readLut${slot}(base + vec3(0,0,1)), readLut${slot}(base + vec3(1,0,1)), fraction.x);
  vec3 upperBack = stableLerp(readLut${slot}(base + vec3(0,1,1)), readLut${slot}(base + vec3(1,1,1)), fraction.x);
  return stableLerp(stableLerp(lowerFront, upperFront, fraction.y), stableLerp(lowerBack, upperBack, fraction.y), fraction.z);
}
`;
}

export function createLutFragmentShader(backend = "atlas") {
  if (!["atlas", "3d"].includes(backend)) throw new TypeError("Unknown LUT shader backend");
  const slots = Array.from({ length: MAX_ACTIVE_LOOKS }, (_, slot) => slot);
  return `
precision highp float;
${backend === "3d" ? "precision highp sampler3D;" : ""}
varying vec2 vUv;
uniform sampler2D uSource;
uniform vec4 uWeights;
uniform float uIntensity;
uniform float uInputScale;
uniform float uOutputScale;
uniform int uActiveLooks;
uniform int uChangesEncoding;
vec3 stableLerp(vec3 start, vec3 end, float weight) { return start + weight * (end - start); }
${slots.map((slot) => createSampler(slot, backend)).join("\n")}
void main() {
  vec4 source = texture2D(uSource, vUv);
  if (uActiveLooks == 0 || uIntensity == 0.0) { gl_FragColor = source; return; }
  vec3 original = source.rgb / uInputScale;
  vec3 result = original;
  ${slots.map((slot) => `if (uWeights[${slot}] > 0.0) {
    vec3 transformed = sampleLut${slot}(original);
    if (uChangesEncoding == 1) { gl_FragColor = vec4(transformed * uOutputScale, source.a); return; }
    result += uWeights[${slot}] * (transformed - original);
  }`).join("\n  ")}
  gl_FragColor = vec4(stableLerp(original, result, uIntensity) * uOutputScale, source.a);
}
`;
}
