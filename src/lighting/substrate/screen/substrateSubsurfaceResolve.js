import { SUBSTRATE_SCREEN_VERTEX } from './substrateScreenQuad.js';

export function createBurleyDiskSamples(sampleCount = 48) {
  if (!Number.isInteger(sampleCount) || sampleCount < 4 || sampleCount > 48 || sampleCount % 2) throw new Error('Diffusion sample count must be an even integer from 4 to 48');
  const samples = new Float32Array(96);
  const pairCount = sampleCount / 2;
  for (let index = 0; index < pairCount; index++) {
    const probability = (index + 0.5) / pairCount;
    let minimum = 0;
    let maximum = 48;
    for (let step = 0; step < 40; step++) {
      const middle = (minimum + maximum) / 2;
      const cdf = 1 - 0.25 * Math.exp(-middle) - 0.75 * Math.exp(-middle / 3);
      if (cdf < probability) minimum = middle; else maximum = middle;
    }
    const radius = (minimum + maximum) / 2;
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const horizontal = radius * Math.cos(angle);
    const vertical = radius * Math.sin(angle);
    samples.set([horizontal, vertical, -horizontal, -vertical], index * 4);
  }
  return samples;
}

export function createSubsurfaceResolveMaterial(THREE) {
  return new THREE.ShaderMaterial({
    name: 'Substrate Burley disk resolve', vertexShader: SUBSTRATE_SCREEN_VERTEX,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
    uniforms: {
      uSbIrradiance: { value: null }, uSbGeometry: { value: null }, uSbMeanFreePath: { value: null }, uSbAlbedo: { value: null },
      uSbDiskSamples: { value: createBurleyDiskSamples() }, uSbSampleCount: { value: 48 },
      uSbProjectionScale: { value: new THREE.Vector2(1, 1) }, uSbOrthographic: { value: 0 }, uSbMillimetersPerWorldUnit: { value: 1000 },
    },
    fragmentShader: `
precision highp float;
varying vec2 vSbScreenUv;
uniform sampler2D uSbIrradiance;
uniform sampler2D uSbGeometry;
uniform sampler2D uSbMeanFreePath;
uniform sampler2D uSbAlbedo;
uniform vec2 uSbDiskSamples[48];
uniform int uSbSampleCount;
uniform vec2 uSbProjectionScale;
uniform float uSbOrthographic;
uniform float uSbMillimetersPerWorldUnit;
vec3 sbDecodeNormal(vec2 encoded) {
 vec3 normal = vec3(encoded, 1.0 - abs(encoded.x) - abs(encoded.y));
 if (normal.z < 0.0) normal.xy = (1.0 - abs(normal.yx)) * mix(vec2(-1.0), vec2(1.0), step(vec2(0.0), normal.xy));
 return normalize(normal);
}
void main() {
 vec4 geometry = texture2D(uSbGeometry, vSbScreenUv);
 vec3 meanFreePath = texture2D(uSbMeanFreePath, vSbScreenUv).rgb;
 vec3 irradiance = texture2D(uSbIrradiance, vSbScreenUv).rgb;
 vec3 albedo = texture2D(uSbAlbedo, vSbScreenUv).rgb;
 if (geometry.a < 0.5 || max(max(meanFreePath.r, meanFreePath.g), meanFreePath.b) <= 0.0) { gl_FragColor = vec4(0.0); return; }
 vec3 normal = sbDecodeNormal(geometry.xy);
 float viewScale = uSbOrthographic > 0.5 ? 1.0 : max(geometry.z, 0.00001);
 vec3 shapeFactor = 1.9 - albedo + 3.5 * (albedo - 0.8) * (albedo - 0.8);
 vec3 shapedDistance = meanFreePath / shapeFactor / uSbMillimetersPerWorldUnit;
 vec3 result = vec3(0.0);
 for (int channel = 0; channel < 3; channel++) {
   if (meanFreePath[channel] <= 0.0) { result[channel] = irradiance[channel]; continue; }
   float sum = 0.0;
   for (int sampleIndex = 0; sampleIndex < 48; sampleIndex++) {
     if (sampleIndex >= uSbSampleCount) break;
     vec2 sampleUv = vSbScreenUv + uSbDiskSamples[sampleIndex] * shapedDistance[channel] * uSbProjectionScale / viewScale;
     bool inside = all(greaterThanEqual(sampleUv, vec2(0.0))) && all(lessThanEqual(sampleUv, vec2(1.0)));
     vec4 neighbor = texture2D(uSbGeometry, clamp(sampleUv, 0.0, 1.0));
     float normalAgreement = dot(normal, sbDecodeNormal(neighbor.xy));
     float depthDifference = abs(neighbor.z - geometry.z) * uSbMillimetersPerWorldUnit;
     float neighborMfp = texture2D(uSbMeanFreePath, clamp(sampleUv, 0.0, 1.0))[channel];
     bool continuous = inside && abs(neighbor.a - geometry.a) < 0.5 && normalAgreement > 0.8 && depthDifference < max(meanFreePath[channel], 0.001) && abs(neighborMfp - meanFreePath[channel]) < max(0.001, meanFreePath[channel] * 0.25);
     sum += continuous ? texture2D(uSbIrradiance, sampleUv)[channel] : irradiance[channel];
   }
   result[channel] = sum / float(uSbSampleCount);
 }
 gl_FragColor = vec4((result - irradiance) * albedo, geometry.z);
}
`,
  });
}
