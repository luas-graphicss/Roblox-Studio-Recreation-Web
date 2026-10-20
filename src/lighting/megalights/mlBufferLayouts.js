export const MGL_LAYOUT_STATUS = Object.freeze({
  frozen: "frozen",
  reserved: "reserved",
  definedElsewhere: "definedElsewhere",
});

function freezeLayouts(layouts) {
  Object.keys(layouts).forEach((bufferName) => {
    const layout = layouts[bufferName];
    (layout.texels || []).forEach((texel) => Object.freeze(texel));
    Object.freeze(layout.texels);
    Object.freeze(layout);
  });
  return Object.freeze(layouts);
}


export const MGL_BUFFER_LAYOUTS = freezeLayouts({
  sceneDepth: {
    owner: "ML-F3",
    status: "frozen",
    texelCount: 1,
    purpose: "depth of the current frame, the substrate of a deferred path",
    texels: [{ r: "nonLinearDepth" }],
  },
  sceneNormal: {
    owner: "ML-F3",
    status: "frozen",
    texelCount: 1,
    purpose: "surface orientation and which shading model to run",
    texels: [{ r: "normalX", g: "normalY", b: "normalZ", a: "shadingModelIndex" }],
  },
  sceneAlbedoRoughness: {
    owner: "ML-F3",
    status: "frozen",
    texelCount: 1,
    purpose: "the terms factored OUT of the shaded radiance so the denoiser sees light, not texture",
    texels: [{ r: "albedoR", g: "albedoG", b: "albedoB", a: "roughness" }],
  },
  sceneVelocity: {
    owner: "ML-F3",
    status: "frozen",
    texelCount: 1,
    purpose: "where this pixel was in the previous frame",
    texels: [{ r: "screenVelocityX", g: "screenVelocityY" }],
  },
  hierarchicalDepth: {
    owner: "ML-F3",
    status: "frozen",
    texelCount: 1,
    purpose: "min/max pyramid: min accelerates the screen trace, max culls grid cells",
    texels: [{ r: "minDepth", g: "maxDepth" }],
  },
  packedLights: {
    owner: "ML-F4",
    status: "definedElsewhere",
    definedIn: "MGL_LIGHT_BUFFER_LAYOUT",
    texelCount: 4,
    purpose: "every local light as an area light, 4 RGBA float texels each",
    texels: [],
  },
  lightGridCoarse: {
    owner: "ML-F5",
    status: "reserved",
    texelCount: 1,
    purpose: "coarse froxel pass that shrinks the work of the main pass",
    texels: [],
  },
  lightGridMain: {
    owner: "ML-F5",
    status: "reserved",
    texelCount: 1,
    purpose: "packed per froxel light lists",
    texels: [],
  },
  lightFunctionAtlas: {
    owner: "ML-F6",
    status: "frozen",
    texelCount: 1,
    purpose: "cookies, IES profiles and rect textures sharing one texture unit",
    texels: [
      {
        r: "lightFunctionRed",
        g: "lightFunctionGreen",
        b: "lightFunctionBlue",
        a: "lightFunctionAlpha",
      },
    ],
  },
  blueNoise: {
    owner: "ML-F8",
    status: "frozen",
    texelCount: 1,
    purpose: "four independent spatio temporal blue noise channels",
    texels: [{ r: "noiseChannel0", g: "noiseChannel1", b: "noiseChannel2", a: "noiseChannel3" }],
  },
  visibleLightList: {
    owner: "ML-F9",
    status: "frozen",
    texelCount: 1,
    purpose: "one texel per guided light of an 8x8 tile",
    texels: [
      {
        r: "lightIndex",
        g: "tileContributionWeight",
        b: "needsShadowTrace",
        a: "lightShapeIndex",
      },
    ],
  },
  lightSamples: {
    owner: "ML-F11",
    status: "frozen",
    texelCount: 1,
    purpose: "the sample buffer: which light was drawn, with what weight, at which point of the source",
    texels: [
      {
        r: "lightIndex",
        g: "reservoirWeight",
        b: "sourcePointU",
        a: "sourcePointV",
      },
    ],
  },
  traceTileList: {
    owner: "ML-F13",
    status: "frozen",
    texelCount: 1,
    purpose: "the trace buffer: compacted 16x16 tiles with the class that decides who traces them",
    texels: [
      {
        r: "tileX",
        g: "tileY",
        b: "tileClassIndex",
        a: "sampleCount",
      },
    ],
  },
  sampleVisibility: {
    owner: "ML-F17",
    status: "frozen",
    texelCount: 1,
    purpose: "visible, occluded or UNKNOWN per sample, and which tracer answered",
    texels: [
      {
        r: "traceResultIndex",
        g: "traceKindIndex",
        b: "normalizedHitDistance",
        a: "raysSpent",
      },
    ],
  },
  shadedDiffuse: {
    owner: "ML-F18",
    status: "frozen",
    texelCount: 1,
    purpose: "the shading buffer for diffuse, with albedo factored out",
    texels: [{ r: "radianceR", g: "radianceG", b: "radianceB", a: "sampleWeightSum" }],
  },
  shadedSpecular: {
    owner: "ML-F18",
    status: "frozen",
    texelCount: 1,
    purpose: "the shading buffer for specular, with EnvBRDF factored out",
    texels: [{ r: "radianceR", g: "radianceG", b: "radianceB", a: "sampleWeightSum" }],
  },
  historyDiffuse: {
    owner: "ML-F20",
    status: "frozen",
    texelCount: 1,
    purpose: "accumulated diffuse history; alpha carries the history length, never a flag",
    texels: [{ r: "radianceR", g: "radianceG", b: "radianceB", a: "accumulatedFrameCount" }],
  },
  historySpecular: {
    owner: "ML-F20",
    status: "frozen",
    texelCount: 1,
    purpose: "accumulated specular history; alpha carries the history length",
    texels: [{ r: "radianceR", g: "radianceG", b: "radianceB", a: "accumulatedFrameCount" }],
  },
  temporalVariance: {
    owner: "ML-F20",
    status: "frozen",
    texelCount: 1,
    purpose: "the variance buffer: what the spatial filter reads to decide how hard to filter",
    texels: [{ r: "diffuseVariance", g: "specularVariance" }],
  },
  shadingConfidence: {
    owner: "ML-F22",
    status: "frozen",
    texelCount: 1,
    purpose: "the confidence buffer handed to the TSR",
    texels: [{ r: "shadingConfidence" }],
  },
  volumeFroxel: {
    owner: "ML-F23",
    status: "reserved",
    texelCount: 1,
    purpose: "scattered radiance injected in the froxel grid",
    texels: [],
  },
  worldVoxelSh: {
    owner: "ML-F24",
    status: "reserved",
    texelCount: 2,
    purpose: "two band spherical harmonics per world voxel, two RGBA float texels",
    texels: [],
  },
});

export function bufferLayout(bufferName) {
  return MGL_BUFFER_LAYOUTS[bufferName] || null;
}

export function layoutNamesWithStatus(statusName) {
  return Object.keys(MGL_BUFFER_LAYOUTS).filter(
    (bufferName) => MGL_BUFFER_LAYOUTS[bufferName].status === statusName,
  );
}

export function channelNamesOf(bufferName) {
  const layout = bufferLayout(bufferName);
  if (!layout) return [];
  return layout.texels.reduce((names, texel) => names.concat(Object.keys(texel)), []);
}
