import { MGL_UNIFORMS } from "./mlUniformNames.js";
import {
  DOWNSAMPLE_PATTERNS,
  PATTERN_UNIFORM_VALUES,
  TEMPORAL_JITTER_POLICIES,
  patternOffsetOrder,
} from "./mlDownsamplePatternCore.js";

export const DOWNSAMPLE_PATTERN_GLSL_REVISION = 1;

export const DOWNSAMPLE_PATTERN_GLSL_LANGUAGE = "GLSL ES 3.00";
export const DOWNSAMPLE_PATTERN_GLSL_LANGUAGE_REASON =
  "the spatial jitter mirrors integerHash bit for bit, which needs 32 bit uint xor and shift";


export const DOWNSAMPLE_PATTERN_OWNED_UNIFORM_NAMES = Object.freeze([
  "uMglDownsampleFactor",
  "uMglDownsamplePattern",
]);


export const DOWNSAMPLE_PATTERN_INPUT_UNIFORM_NAMES = Object.freeze(["uMglFrameIndex"]);


export const DOWNSAMPLE_PATTERN_GLSL_FUNCTIONS = Object.freeze([
  "mglDownsampleNonNegative",
  "mglDownsampleModulo",
  "mglDownsampleOffsetCount",
  "mglDownsampleIntegerHash",
  "mglDownsampleStructuralPhase",
  "mglDownsampleBlockSpatialPhase",
  "mglDownsampleTemporalRotation",
  "mglDownsampleOffsetIndex",
  "mglDownsampleOffsetForIndex",
  "mglDownsampleSampledOffset",
  "mglDownsampleFactorFromUniform",
  "mglDownsamplePatternFromUniform",
  "mglDownsampleBlockForFullPixel",
  "mglDownsampleFullPixelForBlockOffset",
  "mglDownsampleSampledFullPixel",
  "mglIsFullPixelSampled",
]);


export const DOWNSAMPLE_PATTERN_GLSL_NOT_MIRRORED = Object.freeze({
  policy: TEMPORAL_JITTER_POLICIES.jitteredGroups,
  reason:
    "the group phase comes from ML-F8 on the CPU; mirroring a guess would desynchronise the two sides",
});

const FOUR_ROOKS_SIDE = Math.round(
  Math.sqrt(patternOffsetOrder(DOWNSAMPLE_PATTERNS.fourRooks).length),
);


const HASH_CONSTANTS = Object.freeze({
  firstAddend: "0x9e3779b9",
  firstFactor: "0x85ebca6b",
  secondAddend: "0xc2b2ae35",
  secondFactor: "0x27d4eb2f",
  firstShift: 13,
  secondShift: 16,
});

const PATTERN_DEFINE_NAMES = Object.freeze({
  [DOWNSAMPLE_PATTERNS.none]: "MGL_DOWNSAMPLE_PATTERN_NONE",
  [DOWNSAMPLE_PATTERNS.checkerboard]: "MGL_DOWNSAMPLE_PATTERN_CHECKERBOARD",
  [DOWNSAMPLE_PATTERNS.fourRooks]: "MGL_DOWNSAMPLE_PATTERN_FOUR_ROOKS",
});


export function assertDownsamplePatternUniformsAreReserved() {
  const factor = MGL_UNIFORMS[DOWNSAMPLE_PATTERN_OWNED_UNIFORM_NAMES[0]];
  const pattern = MGL_UNIFORMS[DOWNSAMPLE_PATTERN_OWNED_UNIFORM_NAMES[1]];
  if (!factor || factor.phase !== "ML-F12" || factor.type !== "float") {
    throw new Error("ML-F12: uMglDownsampleFactor is not reserved as an ML-F12 float");
  }
  if (!pattern || pattern.phase !== "ML-F12" || pattern.type !== "int") {
    throw new Error("ML-F12: uMglDownsamplePattern is not reserved as an ML-F12 int");
  }
  return true;
}






export function downsamplePatternDefinesGlsl() {
  const patternDefines = Object.keys(PATTERN_UNIFORM_VALUES).map(
    (patternName) =>
      "#define " + PATTERN_DEFINE_NAMES[patternName] + " " + PATTERN_UNIFORM_VALUES[patternName],
  );
  return patternDefines.concat(["#define MGL_FOUR_ROOKS_SIDE " + FOUR_ROOKS_SIDE]).join("\n");
}


export function downsamplePatternUniformDeclarationsGlsl() {
  return [
    "uniform float " + DOWNSAMPLE_PATTERN_OWNED_UNIFORM_NAMES[0] + ";",
    "uniform int " + DOWNSAMPLE_PATTERN_OWNED_UNIFORM_NAMES[1] + ";",
  ].join("\n");
}


function checkerboardBranchesGlsl() {
  const order = patternOffsetOrder(DOWNSAMPLE_PATTERNS.checkerboard);
  return order.map((offset, index) => {
    const returnValue = "ivec2(" + offset.offsetX + ", " + offset.offsetY + ")";
    if (index === order.length - 1) return "    return " + returnValue + ";";
    return "    if (offsetIndex == " + index + ") { return " + returnValue + "; }";
  });
}





export function downsamplePatternFunctionsGlsl() {
  return [
    "// Mirror of zeroOrMore: a negative coordinate is clamped, never wrapped.",
    "int mglDownsampleNonNegative(int value) {",
    "  return max(0, value);",
    "}",
    "",
    "// Integer modulo without the % operator, on non negative values only.",
    "int mglDownsampleModulo(int value, int divisor) {",
    "  int safeDivisor = max(1, divisor);",
    "  int nonNegative = mglDownsampleNonNegative(value);",
    "  return nonNegative - (nonNegative / safeDivisor) * safeDivisor;",
    "}",
    "",
    "// Pixels inside a sample block: 1 at full resolution, 4 checkerboard, 16 four rooks.",
    "int mglDownsampleOffsetCount(int pattern) {",
    "  if (pattern == MGL_DOWNSAMPLE_PATTERN_CHECKERBOARD) { return 4; }",
    "  if (pattern == MGL_DOWNSAMPLE_PATTERN_FOUR_ROOKS) { return MGL_FOUR_ROOKS_SIDE * MGL_FOUR_ROOKS_SIDE; }",
    "  return 1;",
    "}",
    "",
    "// Mirror of integerHash. uint arithmetic wraps modulo 2^32 by specification,",
    "// which is exactly what Math.imul does on the CPU - so the two sides agree bit",
    "// for bit instead of drifting apart by one rounding.",
    "uint mglDownsampleIntegerHash(int seedA, int seedB) {",
    "  uint hashed = (uint(mglDownsampleNonNegative(seedA)) + " +
      HASH_CONSTANTS.firstAddend +
      "u) * " +
      HASH_CONSTANTS.firstFactor +
      "u;",
    "  hashed = hashed ^ (hashed >> " + HASH_CONSTANTS.firstShift + "u);",
    "  hashed = (hashed + uint(mglDownsampleNonNegative(seedB)) + " +
      HASH_CONSTANTS.secondAddend +
      "u) * " +
      HASH_CONSTANTS.secondFactor +
      "u;",
    "  hashed = hashed ^ (hashed >> " + HASH_CONSTANTS.secondShift + "u);",
    "  return hashed;",
    "}",
    "",
    "// STRUCTURAL PHASE: the named pattern. It pushes a neighbouring block onto",
    "// another pixel, which is what makes one frame look like a checkerboard (or a",
    "// rook move) instead of a regular grid.",
    "int mglDownsampleStructuralPhase(int pattern, int blockX, int blockY) {",
    "  int x = mglDownsampleNonNegative(blockX);",
    "  int y = mglDownsampleNonNegative(blockY);",
    "  if (pattern == MGL_DOWNSAMPLE_PATTERN_CHECKERBOARD) { return mglDownsampleModulo(x + y, 2) * 2; }",
    "  if (pattern == MGL_DOWNSAMPLE_PATTERN_FOUR_ROOKS) {",
    "    return mglDownsampleModulo(x + 3 * y, MGL_FOUR_ROOKS_SIDE) * MGL_FOUR_ROOKS_SIDE;",
    "  }",
    "  return 0;",
    "}",
    "",
    "// SPATIAL JITTER: per block phase, CONSTANT over time. Constant is the whole",
    "// proof: only the temporal term moves, so the offset index of a block walks",
    "// 0..N-1 in order and covers the block exactly once per window of N frames.",
    "int mglDownsampleBlockSpatialPhase(int blockX, int blockY, int offsetCount) {",
    "  if (offsetCount <= 1) { return 0; }",
    "  uint hashed = mglDownsampleIntegerHash(blockX, blockY);",
    "  uint count = uint(offsetCount);",
    "  return int(hashed - (hashed / count) * count);",
    "}",
    "",
    "// TEMPORAL JITTER: +1 per frame, under the strictSlidingWindow policy.",
    "int mglDownsampleTemporalRotation(int frameIndex, int offsetCount) {",
    "  if (offsetCount <= 1) { return 0; }",
    "  return mglDownsampleModulo(frameIndex, offsetCount);",
    "}",
    "",
    "// THE ONE EQUATION OF THE PHASE.",
    "int mglDownsampleOffsetIndex(int pattern, ivec2 blockCoordinate, int frameIndex) {",
    "  int offsetCount = mglDownsampleOffsetCount(pattern);",
    "  int phaseSum = mglDownsampleStructuralPhase(pattern, blockCoordinate.x, blockCoordinate.y)",
    "    + mglDownsampleBlockSpatialPhase(blockCoordinate.x, blockCoordinate.y, offsetCount)",
    "    + mglDownsampleTemporalRotation(frameIndex, offsetCount);",
    "  return mglDownsampleModulo(phaseSum, offsetCount);",
    "}",
    "",
    "// The traversal tables, emitted from the CPU order so they cannot drift.",
    "ivec2 mglDownsampleOffsetForIndex(int pattern, int offsetIndex) {",
    "  if (pattern == MGL_DOWNSAMPLE_PATTERN_CHECKERBOARD) {",
  ]
    .concat(checkerboardBranchesGlsl())
    .concat([
      "  }",
      "  if (pattern == MGL_DOWNSAMPLE_PATTERN_FOUR_ROOKS) {",
      "    // Latin square: row = index mod 4, column = (row + index / 4) mod 4. Every",
      "    // aligned group of four indices uses four distinct rows AND four columns.",
      "    int rowInsideBlock = mglDownsampleModulo(offsetIndex, MGL_FOUR_ROOKS_SIDE);",
      "    int groupIndex = mglDownsampleNonNegative(offsetIndex) / MGL_FOUR_ROOKS_SIDE;",
      "    return ivec2(mglDownsampleModulo(rowInsideBlock + groupIndex, MGL_FOUR_ROOKS_SIDE), rowInsideBlock);",
      "  }",
      "  return ivec2(0, 0);",
      "}",
      "",
      "ivec2 mglDownsampleSampledOffset(int pattern, ivec2 blockCoordinate, int frameIndex) {",
      "  return mglDownsampleOffsetForIndex(pattern, mglDownsampleOffsetIndex(pattern, blockCoordinate, frameIndex));",
      "}",
      "",
      "// The two uniforms of the phase, read in ONE place each.",
      "int mglDownsampleFactorFromUniform() {",
      "  return int(max(1.0, " + DOWNSAMPLE_PATTERN_OWNED_UNIFORM_NAMES[0] + "));",
      "}",
      "",
      "int mglDownsamplePatternFromUniform() {",
      "  return " + DOWNSAMPLE_PATTERN_OWNED_UNIFORM_NAMES[1] + ";",
      "}",
      "",
      "ivec2 mglDownsampleBlockForFullPixel(ivec2 fullPixel, int factor) {",
      "  int safeFactor = max(1, factor);",
      "  return ivec2(",
      "    mglDownsampleNonNegative(fullPixel.x) / safeFactor,",
      "    mglDownsampleNonNegative(fullPixel.y) / safeFactor",
      "  );",
      "}",
      "",
      "// Mirror of pixelsInsideBlock + fullPixelForBlockOffset: the offset is CLAMPED",
      "// onto the pixels the block really has, because an edge block of a resolution",
      "// that is not a multiple of the factor has fewer. A block entirely outside the",
      "// image answers ivec2(-1) and the caller MUST test it - clamping that one to",
      "// zero would shade a pixel that does not exist.",
      "ivec2 mglDownsampleFullPixelForBlockOffset(ivec2 blockCoordinate, ivec2 offset, int factor, ivec2 fullResolution) {",
      "  int safeFactor = max(1, factor);",
      "  ivec2 firstPixel = ivec2(",
      "    mglDownsampleNonNegative(blockCoordinate.x),",
      "    mglDownsampleNonNegative(blockCoordinate.y)",
      "  ) * safeFactor;",
      "  int columns = max(0, min(safeFactor, mglDownsampleNonNegative(fullResolution.x) - firstPixel.x));",
      "  int rows = max(0, min(safeFactor, mglDownsampleNonNegative(fullResolution.y) - firstPixel.y));",
      "  if (columns == 0 || rows == 0) { return ivec2(-1, -1); }",
      "  return firstPixel + ivec2(",
      "    min(mglDownsampleNonNegative(offset.x), columns - 1),",
      "    min(mglDownsampleNonNegative(offset.y), rows - 1)",
      "  );",
      "}",
      "",
      "ivec2 mglDownsampleSampledFullPixel(int pattern, ivec2 blockCoordinate, int factor, int frameIndex, ivec2 fullResolution) {",
      "  ivec2 offset = mglDownsampleSampledOffset(pattern, blockCoordinate, frameIndex);",
      "  return mglDownsampleFullPixelForBlockOffset(blockCoordinate, offset, factor, fullResolution);",
      "}",
      "",
      "// True when THIS full resolution pixel is the one its block samples this frame.",
      "bool mglIsFullPixelSampled(ivec2 fullPixel, int pattern, int factor, int frameIndex, ivec2 fullResolution) {",
      "  ivec2 blockCoordinate = mglDownsampleBlockForFullPixel(fullPixel, factor);",
      "  ivec2 sampledPixel = mglDownsampleSampledFullPixel(pattern, blockCoordinate, factor, frameIndex, fullResolution);",
      "  if (sampledPixel.x < 0) { return false; }",
      "  ivec2 clampedPixel = ivec2(",
      "    mglDownsampleNonNegative(fullPixel.x),",
      "    mglDownsampleNonNegative(fullPixel.y)",
      "  );",
      "  return sampledPixel == clampedPixel;",
      "}",
    ])
    .join("\n");
}


export function downsamplePatternGlslChunk() {
  assertDownsamplePatternUniformsAreReserved();
  return [
    downsamplePatternDefinesGlsl(),
    downsamplePatternUniformDeclarationsGlsl(),
    downsamplePatternFunctionsGlsl(),
  ].join("\n");
}


export function describeDownsamplePatternGlsl() {
  return Object.freeze({
    revision: DOWNSAMPLE_PATTERN_GLSL_REVISION,
    language: DOWNSAMPLE_PATTERN_GLSL_LANGUAGE,
    languageReason: DOWNSAMPLE_PATTERN_GLSL_LANGUAGE_REASON,
    injectsItself: false,
    reservedTextureUnits: 0,
    ownedUniforms: DOWNSAMPLE_PATTERN_OWNED_UNIFORM_NAMES,
    inputUniforms: DOWNSAMPLE_PATTERN_INPUT_UNIFORM_NAMES,
    functions: DOWNSAMPLE_PATTERN_GLSL_FUNCTIONS,
    notMirrored: DOWNSAMPLE_PATTERN_GLSL_NOT_MIRRORED,
  });
}
