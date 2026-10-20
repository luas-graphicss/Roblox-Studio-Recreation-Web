const OUTPUT_UNIFORMS = `
uniform int cpGeometryOutput;
uniform vec3 cpObjectIdBytes;
uniform vec3 cpMaterialIdBytes;
uniform float cpCustomStencil;
`;

const OUTPUT_SELECTION = `
if (cpGeometryOutput == 1) gl_FragColor = vec4(cpObjectIdBytes, 1.0);
if (cpGeometryOutput == 2) gl_FragColor = vec4(cpMaterialIdBytes, 1.0);
if (cpGeometryOutput == 3) gl_FragColor = vec4(cpCustomStencil, 0.0, 0.0, 1.0);
`;

function replaceRequired(source, anchor, replacement) {
  if (!source.includes(anchor)) throw new Error(`CP-F05 shader anchor is missing: ${anchor}`);
  return source.replace(anchor, replacement);
}

export function patchGeometryShader(shader, kind, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = OUTPUT_UNIFORMS + shader.fragmentShader;
  if (kind === "mesh") {
    shader.vertexShader = replaceRequired(shader.vertexShader, "#include <uv_pars_vertex>", "#include <uv_pars_vertex>\n#include <color_pars_vertex>");
    shader.vertexShader = replaceRequired(shader.vertexShader, "#include <uv_vertex>", "#include <uv_vertex>\n#include <color_vertex>\n#include <morphcolor_vertex>");
    shader.fragmentShader = replaceRequired(shader.fragmentShader, "#include <packing>", "#include <common>\n#include <packing>\n#include <color_pars_fragment>\n#include <map_pars_fragment>\n#include <alphamap_pars_fragment>\n#include <alphatest_pars_fragment>");
    shader.fragmentShader = replaceRequired(shader.fragmentShader, "#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n#include <map_fragment>\n#include <color_fragment>\n#include <alphamap_fragment>\n#include <alphatest_fragment>");
    shader.fragmentShader = replaceRequired(shader.fragmentShader, "gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );", "gl_FragColor = vec4(packNormalToRGB(normal), 1.0);\n" + OUTPUT_SELECTION);
  } else {
    shader.fragmentShader = replaceRequired(shader.fragmentShader, "#include <opaque_fragment>", "gl_FragColor = vec4(0.5, 0.5, 1.0, 1.0);\n" + OUTPUT_SELECTION);
    for (const chunk of ["tonemapping_fragment", "colorspace_fragment", "fog_fragment", "premultiplied_alpha_fragment"]) shader.fragmentShader = shader.fragmentShader.replace(`#include <${chunk}>`, "");
  }
}
