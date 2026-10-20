function freezeRefusals(refusalsByPass) {
  Object.keys(refusalsByPass).forEach((passName) => {
    refusalsByPass[passName].forEach((refusal) => Object.freeze(refusal));
    Object.freeze(refusalsByPass[passName]);
  });
  return Object.freeze(refusalsByPass);
}

export const MGL_PASS_REFUSALS = freezeRefusals({
  sceneInputs: [
    {
      code: "sceneInputs.noSecondGeometryPass",
      refuses: "rendering the scene a second time to build the G-buffer",
      because: "the depth prepass already exists; a second pass doubles the draw calls and desyncs the two",
    },
    {
      code: "sceneInputs.noLighting",
      refuses: "writing any lighting into the G-buffer",
      because: "shading belongs to sampleShading; mixing the two makes the denoiser filter albedo",
    },
  ],
  lightSceneData: [
    {
      code: "lightSceneData.noArrayIndexAsIdentifier",
      refuses: "using the position in the array as the light identifier",
      because: "removing a light in the middle shifts every id and the temporal history follows the wrong light",
    },
    {
      code: "lightSceneData.noPointLightSpecialCase",
      refuses: "a separate code path for point and spot lights",
      because: "every local light is an area light; the special case is what caps the lite at 128 lights",
    },
  ],
  lightGrid: [
    {
      code: "lightGrid.noSecondCluster",
      refuses: "building a second cluster structure next to lightClusterCore",
      because: "the engine already owns one; two structures disagree the day one of them is updated",
    },
    {
      code: "lightGrid.noFalseNegative",
      refuses: "dropping a light to make culling cheaper",
      because: "a missing light is invisible in the average and obvious in the one frame that matters",
    },
  ],
  lightFunctionAtlas: [
    {
      code: "lightFunctionAtlas.noTexturePerLight",
      refuses: "binding one texture per light with a cookie",
      because: "WebGL2 guarantees 16 units; per light textures is the ceiling of 8 the atlas exists to remove",
    },
  ],
  visibleLightList: [
    {
      code: "visibleLightList.notTheOnlySource",
      refuses: "being the only source of samples",
      because: "a strong light off the list would never be sampled; hidden lights keep their own budget",
    },
  ],
  lightSampleGeneration: [
    {
      code: "lightSampleGeneration.noHiddenLightDownWeighting",
      refuses: "down weighting hidden lights instead of budgeting them",
      because: "UE spends a fixed share on hidden lights so a strong one cannot dominate the estimate",
    },
    {
      code: "lightSampleGeneration.noUncorrelatedRandom",
      refuses: "drawing samples from an uncorrelated random generator",
      because: "only spatio temporal blue noise gives the denoiser a filterable error spectrum",
    },
    {
      code: "lightSampleGeneration.noOneLightPerPixel",
      refuses: "settling for one light per pixel",
      because: "the promise is N samples per downsampled pixel; one light per pixel IS the lite",
    },
  ],
  traceTiles: [
    {
      code: "traceTiles.noTraceBeforeClassification",
      refuses: "tracing before the tile is classified and compacted",
      because: "without compaction every tile pays for the most expensive tracer of the frame",
    },
  ],
  screenTrace: [
    {
      code: "screenTrace.noMissWhenLeavingTheScreen",
      refuses: "answering MISS when the ray leaves the screen",
      because: "off screen is UNKNOWN; answering miss turns every off screen occluder into a light leak",
    },
  ],
  virtualShadowMapTrace: [
    {
      code: "virtualShadowMapTrace.noSecondAtlas",
      refuses: "allocating a second shadow atlas",
      because: "shadowAtlasCore and shadowPagesCore already exist and this phase is what wakes them up",
    },
  ],
  rayTrace: [
    {
      code: "rayTrace.noWeakTier",
      refuses: "running on the weak tier",
      because: "BVH traversal in the fragment shader is what resets a weak driver",
    },
    {
      code: "rayTrace.noUnboundedRays",
      refuses: "spending rays without a budget",
      because: "the cost must depend on the sample budget, never on the number of lights",
    },
  ],
  sampleShading: [
    {
      code: "sampleShading.noCosmeticDarkening",
      refuses: "multiplying an already shaded buffer to look darker",
      because: "MegaLights REPLACES direct shading and shadowing; darkening the legacy buffer is the lite",
    },
    {
      code: "sampleShading.noAlbedoBeforeDenoise",
      refuses: "multiplying albedo and EnvBRDF back in before the denoiser",
      because: "the filter would smear texture detail and the variance would measure albedo, not light",
    },
  ],
  stochasticUpsample: [
    {
      code: "stochasticUpsample.noBlindBilinear",
      refuses: "upsampling bilinearly without depth and normal weighting",
      because: "a bilinear tap crosses silhouettes and leaks light across every edge of the frame",
    },
  ],
  temporalFilter: [
    {
      code: "temporalFilter.noShadowDenoiserReuse",
      refuses: "reusing the shadow denoiser of the engine",
      because: "MegaLights needs its own temporal variance; the shadow denoiser does not produce it",
    },
    {
      code: "temporalFilter.noHistoryWithoutReprojection",
      refuses: "accumulating history without motion vectors",
      because: "unreprojected history is a ghost trail that no spatial filter can remove",
    },
  ],
  spatialFilter: [
    {
      code: "spatialFilter.noMultiPassATrous",
      refuses: "running several A-Trous passes",
      because: "UE uses ONE sparse kernel rotated per pixel; the multi pass version costs more and blurs more",
    },
    {
      code: "spatialFilter.noRecurrentBlurThroughHistory",
      refuses: "feeding the blurred result back into the history",
      because: "recurrent blur keeps widening forever and the image never returns to sharp",
    },
  ],
});

export function refusalsOfPass(passName) {
  return MGL_PASS_REFUSALS[passName] || [];
}

export function refusalCodes() {
  return Object.keys(MGL_PASS_REFUSALS).reduce(
    (codes, passName) => codes.concat(MGL_PASS_REFUSALS[passName].map((refusal) => refusal.code)),
    [],
  );
}
