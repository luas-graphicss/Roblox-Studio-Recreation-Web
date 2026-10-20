import { MGL_UNIFORMS } from "../mlUniformNames.js";
import { uniformRef } from "../runtime/megaLightsPatchRegistry.js";

function textureSource(texture, origin, extra = {}) {
  const image = texture?.image;
  if (!texture?.isTexture || !(image?.width > 0) || !(image?.height > 0))
    return {
      available: false,
      reason: "No readable texture dimensions",
      origin,
    };
  return {
    available: true,
    texture,
    width: image.width,
    height: image.height,
    origin,
    ...extra,
  };
}

function rgb(value, alpha = 1) {
  if (!value) return [0, 0, 0, 0];
  if (Array.isArray(value) || ArrayBuffer.isView(value))
    return [value[0] ?? NaN, value[1] ?? NaN, value[2] ?? NaN, alpha];
  return [
    value.r ?? value.red ?? NaN,
    value.g ?? value.green ?? NaN,
    value.b ?? value.blue ?? NaN,
    alpha,
  ];
}

function cpuSource(signal, read, origin) {
  if (!signal || signal.ready === false)
    return {
      available: false,
      reason: "No output published in this frame",
      origin,
    };
  const width = signal.width || signal.fullWidth;
  const height = signal.height || signal.fullHeight;
  if (!(width > 0 && height > 0))
    return {
      available: false,
      reason: "Output dimensions are missing",
      origin,
    };
  return {
    available: true,
    width,
    height,
    read,
    origin,
    backend: "CPU reference",
  };
}

export function resolveDebugSource(id, frame, host, level = 0) {
  if (!frame)
    return {
      available: false,
      reason: "No accepted Future frame; the pipeline gate is closed",
    };
  const sceneInputs = frame.sceneInputs;
  const attachment =
    {
      roughness: "sceneNormal",
      metalness: "sceneAlbedo",
      coverage: "sceneDepth",
    }[id] || id;
  if (
    ["sceneDepth", "sceneNormal", "sceneAlbedo", "sceneVelocity"].includes(
      attachment,
    )
  ) {
    if (!sceneInputs?.ready)
      return {
        available: false,
        reason: "F3 scene inputs are not ready in this frame",
      };
    return textureSource(
      sceneInputs.textures[attachment],
      "F3 current-frame MRT",
      {
        backend: "GPU attachment",
        producerFrame: sceneInputs.frameIndex ?? null,
        observedFrame: frame.frameIndex ?? null,
      },
    );
  }
  if (id === "hierarchicalDepth" || id === "hzbMaximum") {
    const pyramid = sceneInputs?.hierarchicalDepth;
    if (!pyramid?.built)
      return { available: false, reason: "F3 produced no depth pyramid" };
    const selectedLevel = Math.min(Math.max(0, level), pyramid.levelCount - 1);
    const dimensions = pyramid.levelSize(selectedLevel);
    if (!dimensions)
      return { available: false, reason: "HZB level has no dimensions" };
    return {
      available: true,
      ...dimensions,
      get texture() {
        return pyramid.textureFor(selectedLevel);
      },
      origin: "F3 HZB level " + selectedLevel,
      level: selectedLevel,
      levelCount: pyramid.levelCount,
      backend: "GPU depth reduction",
    };
  }
  const textureHandles = {
    packedLights: frame.lightSceneData,
    lightGridMain: frame.lightGrid,
    lightFunctionAtlas: frame.lightFunctionAtlas,
    visibleLightList: frame.visibleLightList,
    lightSamples: frame.lightSamples,
    sampleWeights: frame.lightSamples,
    traceTileList: frame.traceTiles,
  };
  if (id in textureHandles) {
    const handle = textureHandles[id];
    if (!handle || handle.ready === false)
      return {
        available: false,
        reason:
          handle?.reason ||
          "The producer published no ready handle in this frame",
      };
    return textureSource(
      handle.texture ||
        handle.tileListTexture ||
        handle.atlasTexture ||
        handle.listTexture,
      "Current-frame " + (handle.owner || id),
      {
        backend: "CPU-packed texture / GPU sampling",
        producerFrame: handle.frameIndex ?? null,
        inputFrame: handle.sourceFrameIndex ?? null,
        observedFrame: frame.frameIndex,
      },
    );
  }
  if (id === "lightGridCoarse")
    return {
      available: false,
      reason:
        "F5 does not publish a separate coarse-grid image; inspect its cell counters",
    };
  if (id === "sampleVisibility")
    return {
      available: false,
      reason:
        "No sampleVisibility texture is published by F17. UNKNOWN is not visible. Inspect trace-policy counters and refusals.",
    };
  if (id === "shadedDiffuse" || id === "shadedSpecular") {
    const signal = frame.shadedSignals;
    return cpuSource(
      signal,
      (x, y) => {
        const texel = signal.readShadedTexel(x, y);
        return rgb(texel?.[id === "shadedDiffuse" ? "diffuse" : "specular"]);
      },
      "F18 shadedSignals",
    );
  }
  if (id === "upsampledShading") {
    const signal = frame.upsampledShading;
    return cpuSource(
      signal,
      (x, y) => {
        const offset = (y * signal.fullWidth + x) * 3;
        return rgb(
          signal.radiance?.subarray
            ? signal.radiance.subarray(offset, offset + 3)
            : signal.radiance?.slice(offset, offset + 3),
        );
      },
      "F19 upsampledShading",
    );
  }
  if (
    [
      "historyDiffuse",
      "historySpecular",
      "historyLength",
      "temporalVariance",
    ].includes(id)
  ) {
    const signal = frame.temporalFilteredShading;
    return cpuSource(
      signal,
      (x, y) => {
        const index = y * signal.width + x;
        if (id === "historyLength")
          return [signal.accumulatedFrameCounts[index], 0, 0, 1];
        if (id === "temporalVariance")
          return [
            signal.diffuseVariance[index],
            signal.specularVariance[index],
            0,
            1,
          ];
        return rgb(
          signal.readFilteredTexel(x, y)?.[
            id === "historyDiffuse" ? "diffuse" : "specular"
          ],
        );
      },
      "F20 temporalFilteredShading",
    );
  }
  if (id === "spatialDiffuse" || id === "spatialSpecular") {
    const signal = frame.spatialFilteredShading;
    return cpuSource(
      signal,
      (x, y) =>
        rgb(
          signal.readFilteredTexel(x, y)?.[
            id === "spatialDiffuse" ? "diffuse" : "specular"
          ],
        ),
      "F21 spatialFilteredShading",
    );
  }
  if (id === "shadingConfidence") {
    const signal = frame.shadingConfidence;
    return cpuSource(
      signal,
      (x, y) => [signal.read(x, y), 0, 0, 1],
      "F22 shadingConfidence",
    );
  }
  if (id === "volumeFroxel") {
    const signal = frame.volumeFroxelGrid;
    if (!signal?.grid || typeof signal.readFroxel !== "function")
      return { available: false, reason: "No F23 volumeFroxelGrid produced" };
    const slice = Math.max(0, Math.min(level, signal.grid.depthSliceCount - 1));
    return {
      available: true,
      width: signal.grid.columnsAcross,
      height: signal.grid.columnsDown,
      read: (x, y) => rgb(signal.readFroxel(x, y, slice)),
      origin: "F23 volume slice " + slice,
      backend: "CPU reference",
      level: slice,
      levelCount: signal.grid.depthSliceCount,
    };
  }
  if (id === "worldVoxelSh") {
    const signal = frame.worldVoxelShGrid;
    if (!signal?.grid || typeof signal.readSphericalHarmonics !== "function")
      return {
        available: false,
        reason: "No F24 world-space SH store published",
      };
    const slice = Math.max(0, Math.min(level, signal.grid.voxelsUp - 1));
    return {
      available: true,
      width: signal.grid.voxelsAcross,
      height: signal.grid.voxelsDeep,
      read: (x, z) => {
        const coefficients = signal.readSphericalHarmonics(x, slice, z);
        return coefficients
          ? [coefficients[0], coefficients[4], coefficients[8], 1]
          : [0, 0, 0, 0];
      },
      origin:
        "F24 world XZ slice y=" +
        slice +
        "; RGB band-0 coefficients, not screen radiance",
      backend: "CPU reference",
      level: slice,
      levelCount: signal.grid.voxelsUp,
    };
  }
  if (id === "blueNoise") {
    if (!host?.blueNoise?.isReady?.())
      return {
        available: false,
        reason: "F8 sliced generation is not ready or has no host handle",
      };
    const uniformName = Object.keys(MGL_UNIFORMS).find(
      (name) => MGL_UNIFORMS[name].buffer === "blueNoise",
    );
    return textureSource(
      uniformName ? uniformRef(uniformName)?.value : null,
      "F8 bound noise volume",
      { backend: "Generated reference data" },
    );
  }
  return { available: false, reason: "No verified source adapter" };
}
