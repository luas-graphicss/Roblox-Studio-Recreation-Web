export const MGL_UNIFORM_PREFIX = "uMgl";


export const MGL_UNIFORM_SCOPE = Object.freeze({
  lighting: "lighting",
  offscreen: "offscreen",
});

export const MGL_UNIFORM_TYPE = Object.freeze({
  sampler2D: "sampler2D",
  int: "int",
  float: "float",
  vec2: "vec2",
  vec3: "vec3",
});

function freezeRegistry(registry) {
  Object.keys(registry).forEach((name) => Object.freeze(registry[name]));
  return Object.freeze(registry);
}


export const MGL_UNIFORMS = freezeRegistry({

  uMglFrameIndex: {
    phase: "base",
    type: "int",
    description: "deterministic frame counter; the only legal source of temporal jitter",
  },
  uMglRenderResolution: {
    phase: "base",
    type: "vec2",
    description: "full resolution of the lit target, in pixels",
  },


  uMglSceneDepth: {
    phase: "ML-F3",
    type: "sampler2D",
    scope: "lighting",
    buffer: "sceneDepth",
    description: "scene depth of the current frame",
  },
  uMglSceneNormal: {
    phase: "ML-F3",
    type: "sampler2D",
    scope: "lighting",
    buffer: "sceneNormal",
    description: "world space normal plus shading model index",
  },
  uMglSceneAlbedoRoughness: {
    phase: "ML-F3",
    type: "sampler2D",
    scope: "lighting",
    buffer: "sceneAlbedoRoughness",
    description: "albedo and roughness, factored OUT of the shaded radiance",
  },
  uMglSceneVelocity: {
    phase: "ML-F3",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "sceneVelocity",
    description: "screen space motion vectors used to reproject history",
  },
  uMglHierarchicalDepth: {
    phase: "ML-F3",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "hierarchicalDepth",
    description: "min/max depth pyramid that accelerates the screen trace and the grid culling",
  },


  uMglPackedLights: {
    phase: "ML-F4",
    type: "sampler2D",
    scope: "lighting",
    buffer: "packedLights",
    description: "every local light as an area light, 4 RGBA float texels each",
  },
  uMglLightCount: {
    phase: "ML-F4",
    type: "int",
    description: "how many lights are packed this frame",
  },


  uMglLightGridMain: {
    phase: "ML-F5",
    type: "sampler2D",
    scope: "lighting",
    buffer: "lightGridMain",
    description: "packed per froxel light lists read while shading",
  },
  uMglLightGridCoarse: {
    phase: "ML-F5",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "lightGridCoarse",
    description: "coarse pass that shrinks the work of the main pass",
  },
  uMglLightGridSize: {
    phase: "ML-F5",
    type: "vec3",
    description: "froxel counts in x, y and depth",
  },


  uMglLightFunctionAtlas: {
    phase: "ML-F6",
    type: "sampler2D",
    scope: "lighting",
    buffer: "lightFunctionAtlas",
    description: "cookies, gobos, IES profiles and rect textures in ONE unit",
  },
  uMglLightFunctionAtlasSize: {
    phase: "ML-F6",
    type: "vec2",
    description: "atlas size in texels, needed to walk a slot without bleeding",
  },


  uMglAreaSampleCount: {
    phase: "ML-F7",
    type: "int",
    description: "points drawn on the light source per sample",
  },


  uMglBlueNoise: {
    phase: "ML-F8",
    type: "sampler2D",
    scope: "lighting",
    buffer: "blueNoise",
    description: "spatio temporal blue noise tile, the only random source",
  },
  uMglBlueNoiseFrameOffset: {
    phase: "ML-F8",
    type: "int",
    description: "slice of the noise used this frame",
  },


  uMglVisibleLightList: {
    phase: "ML-F9",
    type: "sampler2D",
    scope: "lighting",
    buffer: "visibleLightList",
    description: "lights that guide the sampling of each 8x8 tile",
  },
  uMglVisibleLightsPerTile: {
    phase: "ML-F9",
    type: "int",
    description: "how many guided lights a tile may hold",
  },
  uMglGuidingTileSize: {
    phase: "ML-F9",
    type: "int",
    description: "edge of the guiding tile in pixels",
  },


  uMglHiddenLightSampleFraction: {
    phase: "ML-F10",
    type: "float",
    description: "share of samples kept for lights OUTSIDE the visible list",
  },


  uMglLightSamples: {
    phase: "ML-F11",
    type: "sampler2D",
    scope: "lighting",
    buffer: "lightSamples",
    description: "reservoir samples produced at downsampled resolution",
  },
  uMglSamplesPerPixel: {
    phase: "ML-F11",
    type: "int",
    description: "samples per downsampled pixel, the knob the whole cost hangs on",
  },


  uMglDownsampleFactor: {
    phase: "ML-F12",
    type: "float",
    description: "1 full, 2 half, 4 quarter resolution",
  },
  uMglDownsamplePattern: {
    phase: "ML-F12",
    type: "int",
    description: "none, checkerboard or four rooks",
  },


  uMglTraceTileList: {
    phase: "ML-F13",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "traceTileList",
    description: "compacted list of 16x16 tiles with their trace class",
  },
  uMglTraceTileSize: {
    phase: "ML-F13",
    type: "int",
    description: "edge of the trace tile in pixels",
  },


  uMglScreenTraceStepCount: {
    phase: "ML-F14",
    type: "int",
    description: "maximum HZB steps before the trace answers unknown",
  },
  uMglScreenTraceThickness: {
    phase: "ML-F14",
    type: "float",
    description: "assumed depth thickness of a screen space hit",
  },


  uMglShadowAtlas: {
    phase: "ML-F15",
    type: "sampler2D",
    scope: "lighting",
    externalResource: "engine shadowAtlasCore atlas - reused, never a second atlas",
    description: "shadow pages sampled by the virtual shadow map path",
  },
  uMglShadowAtlasSize: {
    phase: "ML-F15",
    type: "vec2",
    description: "atlas size in texels",
  },
  uMglVirtualShadowMapLightLimit: {
    phase: "ML-F15",
    type: "int",
    description: "how many lights may own pages in this tier",
  },


  uMglBvhNodes: {
    phase: "ML-F16",
    type: "sampler2D",
    scope: "lighting",
    externalResource: "engine bvhCore node buffer - reused, never a second BVH",
    description: "BVH nodes traversed in the fragment shader",
  },
  uMglBvhNodeCount: {
    phase: "ML-F16",
    type: "int",
    description: "nodes packed in the BVH texture",
  },
  uMglRaysPerPixel: {
    phase: "ML-F16",
    type: "int",
    description: "world space rays allowed per pixel",
  },


  uMglSampleVisibility: {
    phase: "ML-F17",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "sampleVisibility",
    description: "visible, occluded or unknown per sample, plus who answered",
  },
  uMglTraceRayBudget: {
    phase: "ML-F17",
    type: "int",
    description: "rays the policy may still spend this frame",
  },


  uMglShadedDiffuse: {
    phase: "ML-F18",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "shadedDiffuse",
    description: "diffuse radiance with albedo factored out",
  },
  uMglShadedSpecular: {
    phase: "ML-F18",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "shadedSpecular",
    description: "specular radiance with EnvBRDF factored out",
  },


  uMglUpsampleDepthWeight: {
    phase: "ML-F19",
    type: "float",
    description: "how hard depth disagreement rejects a downsampled neighbour",
  },
  uMglUpsampleNormalWeight: {
    phase: "ML-F19",
    type: "float",
    description: "how hard normal disagreement rejects a downsampled neighbour",
  },


  uMglHistoryDiffuse: {
    phase: "ML-F20",
    type: "sampler2D",
    scope: "lighting",
    buffer: "historyDiffuse",
    description: "accumulated diffuse history",
  },
  uMglHistorySpecular: {
    phase: "ML-F20",
    type: "sampler2D",
    scope: "lighting",
    buffer: "historySpecular",
    description: "accumulated specular history",
  },
  uMglTemporalVariance: {
    phase: "ML-F20",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "temporalVariance",
    description: "temporal variance that drives the spatial filter",
  },
  uMglTemporalFrameCount: {
    phase: "ML-F20",
    type: "int",
    description: "frames already accumulated in the history",
  },


  uMglSpatialKernelRadius: {
    phase: "ML-F21",
    type: "float",
    description: "radius of the single sparse kernel, in pixels",
  },
  uMglSpatialKernelRotation: {
    phase: "ML-F21",
    type: "float",
    description: "per pixel rotation of that kernel, in radians",
  },


  uMglShadingConfidence: {
    phase: "ML-F22",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "shadingConfidence",
    description: "confidence handed to the TSR",
  },
  uMglDisocclusionFrameCount: {
    phase: "ML-F22",
    type: "int",
    description: "frames a disoccluded pixel is still treated as new",
  },
  uMglFireflyClampRatio: {
    phase: "ML-F22",
    type: "float",
    description: "luminance ratio above which a sample is a firefly",
  },


  uMglVolumeFroxel: {
    phase: "ML-F23",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "volumeFroxel",
    description: "scattered radiance injected in the froxel grid",
  },
  uMglVolumeSamplesPerFroxel: {
    phase: "ML-F23",
    type: "int",
    description: "stochastic samples per froxel in this tier",
  },


  uMglWorldVoxelSh: {
    phase: "ML-F24",
    type: "sampler2D",
    scope: "offscreen",
    buffer: "worldVoxelSh",
    description: "two band spherical harmonics per world voxel",
  },
  uMglWorldVoxelGridSize: {
    phase: "ML-F24",
    type: "vec3",
    description: "voxel counts of the world grid",
  },


  uMglHairSampleCount: {
    phase: "ML-F25",
    type: "int",
    description: "samples per hair strand segment",
  },
});

export function uniformNames() {
  return Object.keys(MGL_UNIFORMS);
}

export function uniformDefinition(uniformName) {
  return MGL_UNIFORMS[uniformName] || null;
}

export function uniformsOwnedBy(phaseId) {
  return uniformNames().filter((name) => MGL_UNIFORMS[name].phase === phaseId);
}

export function samplerUniformNames() {
  return uniformNames().filter((name) => MGL_UNIFORMS[name].type === MGL_UNIFORM_TYPE.sampler2D);
}

export function samplerUniformForBuffer(bufferName) {
  return samplerUniformNames().find((name) => MGL_UNIFORMS[name].buffer === bufferName) || null;
}







export function lightingSamplerCountByPhase() {
  const countByPhase = {};
  samplerUniformNames().forEach((name) => {
    const definition = MGL_UNIFORMS[name];
    if (definition.scope !== MGL_UNIFORM_SCOPE.lighting) return;
    countByPhase[definition.phase] = (countByPhase[definition.phase] || 0) + 1;
  });
  return countByPhase;
}
