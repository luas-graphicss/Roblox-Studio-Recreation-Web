import { visibleLightListGlslSource } from "./mlVisibleLightListGlsl.js";


export const LIGHT_SAMPLE_GLSL_REVISION = 1;


export const LIGHT_SAMPLE_GLSL_CONSUMER = "ML-F18";

export const LIGHT_SAMPLE_UNIFORM_NAMES = Object.freeze({
  sampleTexture: "uMglLightSamples",
  samplesPerPixel: "uMglSamplesPerPixel",
});

export function lightSampleUniformDeclarations() {
  return [
    "// ML-F11 light sample buffer: one texel per sample slot, NEAREST, rgba32f.",
    "uniform sampler2D uMglLightSamples;",
    "uniform int uMglSamplesPerPixel;",
    "const float MGL_EMPTY_LIGHT_INDEX = -1.0;",
    "",
    "struct MglLightSample {",
    "  float lightIndex;",
    "  float estimatorWeight;",
    "  vec2 sourcePoint;",
    "};",
  ].join("\n");
}

export function lightSampleFetchFunctions() {
  return [
    "ivec2 mglLightSampleResolution() {",
    "  return textureSize(uMglLightSamples, 0);",
    "}",
    "",
    "int mglSamplesPerPixel() {",
    "  return uMglSamplesPerPixel;",
    "}",
    "",
    "// An out of range read returns the EMPTY sample instead of a clamped",
    "// neighbour: reading the sample of another pixel is a light in the wrong",
    "// place, which no denoiser can undo.",
    "MglLightSample mglFetchLightSample(ivec2 samplePixel, int slotIndex) {",
    "  MglLightSample lightSample;",
    "  lightSample.lightIndex = MGL_EMPTY_LIGHT_INDEX;",
    "  lightSample.estimatorWeight = 0.0;",
    "  lightSample.sourcePoint = vec2(0.0);",
    "  if (slotIndex < 0 || slotIndex >= uMglSamplesPerPixel) return lightSample;",
    "  ivec2 resolution = mglLightSampleResolution();",
    "  int texelX = samplePixel.x * uMglSamplesPerPixel + slotIndex;",
    "  if (samplePixel.x < 0 || samplePixel.y < 0) return lightSample;",
    "  if (texelX >= resolution.x || samplePixel.y >= resolution.y) return lightSample;",
    "  vec4 encoded = texelFetch(uMglLightSamples, ivec2(texelX, samplePixel.y), 0);",
    "  lightSample.lightIndex = encoded.r;",
    "  lightSample.estimatorWeight = encoded.g;",
    "  lightSample.sourcePoint = encoded.ba;",
    "  return lightSample;",
    "}",
    "",
    "bool mglLightSampleIsEmpty(MglLightSample lightSample) {",
    "  return lightSample.lightIndex < 0.0;",
    "}",
  ].join("\n");
}


export function lightSampleGlslSource() {
  return lightSampleUniformDeclarations() + "\n\n" + lightSampleFetchFunctions() + "\n";
}






export function lightSampleGenerationGlslSource() {
  return visibleLightListGlslSource() + "\n" + lightSampleGlslSource();
}
