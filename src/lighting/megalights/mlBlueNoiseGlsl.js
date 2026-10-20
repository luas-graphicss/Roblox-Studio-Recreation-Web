import { MGL_UNIFORMS } from "./mlUniformNames.js";

export const BLUE_NOISE_SAMPLER_UNIFORM = "uMglBlueNoise";
export const BLUE_NOISE_FRAME_OFFSET_UNIFORM = "uMglBlueNoiseFrameOffset";


export function assertBlueNoiseUniformsAreReserved() {
	const sampler = MGL_UNIFORMS[BLUE_NOISE_SAMPLER_UNIFORM];
	const frameOffset = MGL_UNIFORMS[BLUE_NOISE_FRAME_OFFSET_UNIFORM];
	if (!sampler || sampler.phase !== "ML-F8" || sampler.type !== "sampler2D") {
		throw new Error("ML-F8: " + BLUE_NOISE_SAMPLER_UNIFORM + " is not reserved as an ML-F8 sampler2D");
	}
	if (!frameOffset || frameOffset.phase !== "ML-F8" || frameOffset.type !== "int") {
		throw new Error("ML-F8: " + BLUE_NOISE_FRAME_OFFSET_UNIFORM + " is not reserved as an ML-F8 int");
	}
	return true;
}


export function blueNoiseUniformDeclarationsGlsl() {
	return [
		"uniform sampler2D " + BLUE_NOISE_SAMPLER_UNIFORM + ";",
		"uniform int " + BLUE_NOISE_FRAME_OFFSET_UNIFORM + ";",
	].join("\n");
}


export function blueNoiseDefinesGlsl(descriptor) {
	return [
		"#define MGL_BLUE_NOISE_TILE_SIZE " + descriptor.tileSize,
		"#define MGL_BLUE_NOISE_SLICE_COUNT " + descriptor.sliceCount,
		"#define MGL_BLUE_NOISE_CHANNEL_COUNT " + descriptor.channelCount,
	].join("\n");
}


export function blueNoiseFunctionsGlsl() {
	return [
		"ivec2 mglBlueNoiseTexel(ivec2 pixelCoordinate, int sliceIndex) {",
		"  int tiledX = pixelCoordinate.x - (pixelCoordinate.x / MGL_BLUE_NOISE_TILE_SIZE) * MGL_BLUE_NOISE_TILE_SIZE;",
		"  int tiledY = pixelCoordinate.y - (pixelCoordinate.y / MGL_BLUE_NOISE_TILE_SIZE) * MGL_BLUE_NOISE_TILE_SIZE;",
		"  int wrappedSlice = sliceIndex - (sliceIndex / MGL_BLUE_NOISE_SLICE_COUNT) * MGL_BLUE_NOISE_SLICE_COUNT;",
		"  return ivec2(wrappedSlice * MGL_BLUE_NOISE_TILE_SIZE + tiledX, tiledY);",
		"}",
		"",
		"vec4 mglSampleBlueNoise(ivec2 pixelCoordinate) {",
		"  ivec2 texel = mglBlueNoiseTexel(pixelCoordinate, " + BLUE_NOISE_FRAME_OFFSET_UNIFORM + ");",
		"  return texelFetch(" + BLUE_NOISE_SAMPLER_UNIFORM + ", texel, 0);",
		"}",
		"",
		"float mglSampleBlueNoiseChannel(ivec2 pixelCoordinate, int channelIndex) {",
		"  vec4 noise = mglSampleBlueNoise(pixelCoordinate);",
		"  if (channelIndex == 1) { return noise.g; }",
		"  if (channelIndex == 2) { return noise.b; }",
		"  if (channelIndex == 3) { return noise.a; }",
		"  return noise.r;",
		"}",
	].join("\n");
}


export function blueNoiseGlslChunk(descriptor) {
	assertBlueNoiseUniformsAreReserved();
	return [
		blueNoiseDefinesGlsl(descriptor),
		blueNoiseUniformDeclarationsGlsl(),
		blueNoiseFunctionsGlsl(),
	].join("\n");
}
