export const SURFACE_GATHER_UNIFORM_NAMES = Object.freeze({
  sourceAttachment: "uSourceAttachment",
  sourceColumns: "uSourceColumns",
  sourceRows: "uSourceRows",
});

export function buildSurfaceGatherFragmentShader() {
  const names = SURFACE_GATHER_UNIFORM_NAMES;
  return [
    "precision highp float;",
    "uniform sampler2D " + names.sourceAttachment + ";",
    "// One texel per gathered column and per gathered row, holding the BOTTOM UP",
    "// source coordinate in channel r - the same space gl_FragCoord counts in.",
    "uniform sampler2D " + names.sourceColumns + ";",
    "uniform sampler2D " + names.sourceRows + ";",
    "out vec4 outGatheredTexel;",
    "void main() {",
    "  ivec2 latticeTexel = ivec2(gl_FragCoord.xy);",
    "  int sourceColumn = int(texelFetch(" + names.sourceColumns + ", ivec2(latticeTexel.x, 0), 0).r + 0.5);",
    "  int sourceRow = int(texelFetch(" + names.sourceRows + ", ivec2(latticeTexel.y, 0), 0).r + 0.5);",
    "  outGatheredTexel = texelFetch(" + names.sourceAttachment + ", ivec2(sourceColumn, sourceRow), 0);",
    "}",
  ].join("\n");
}

export function describeSurfaceGatherGlsl() {
  return {
    owner: "ML-F3",
    uniforms: SURFACE_GATHER_UNIFORM_NAMES,
    fetch: "texelFetch only, so a gathered texel is bit identical to the screen sized download",
    lookupEncoding:
      "one RGBA float texel per gathered column / row, source coordinate in channel r, rounded and never truncated",
  };
}
