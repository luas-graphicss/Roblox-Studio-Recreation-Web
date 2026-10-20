export const BVH_PACKED_LAYOUT_NAME = "rsw-bvh-gpu-1";
export const BVH_TEXTURE_WIDTH = 1024;
export const BVH_TEXTURE_HEIGHT = 1024;
export const TEXELS_PER_NODE = 2;
export const TEXELS_PER_TRIANGLE = 3;
export const CHANNELS_PER_TEXEL = 4;
export const FLOATS_PER_PACKED_NODE = 8;
export const FLOATS_PER_PACKED_TRIANGLE = 12;

export const MAXIMUM_EXACT_FLOAT_INTEGER = 16777216;

export const BVH_TEXTURE_RESIDUALS = Object.freeze([
  Object.freeze({
    code: "rayTrace.noStorageBuffer",
    residual: "nodes and triangles share ONE RGBA float texture instead of two storage buffers",
    because: "WebGL2 has no storage buffer and the contract reserves a single texture unit for this phase",
  }),
  Object.freeze({
    code: "rayTrace.metaAsFloat",
    residual: "node meta travels as a float instead of the engine's bitcast uint32",
    because: "the shared lighting program is GLSL ES 1.00 and floatBitsToUint does not exist there",
  }),
  Object.freeze({
    code: "rayTrace.fixedTextureSize",
    residual: "the BVH texture has a fixed size and a BVH that does not fit is refused",
    because: "the size is baked into the compiled shader, so a grown texture would leave a stale divisor behind",
  }),
]);

function wholeNumber(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function nodeTexelCount(nodeCount) {
  return wholeNumber(nodeCount) * TEXELS_PER_NODE;
}

export function triangleTexelCount(triangleCount) {
  return wholeNumber(triangleCount) * TEXELS_PER_TRIANGLE;
}


export function describeBvhTextureLayout(request) {
  const settings = request || {};
  const nodeCount = wholeNumber(settings.nodeCount);
  const triangleCount = wholeNumber(settings.triangleCount);
  const width = wholeNumber(settings.width) || BVH_TEXTURE_WIDTH;
  const height = wholeNumber(settings.height) || BVH_TEXTURE_HEIGHT;
  const nodeTexels = nodeTexelCount(nodeCount);
  const triangleTexels = triangleTexelCount(triangleCount);
  const usedTexelCount = nodeTexels + triangleTexels;
  const capacityTexelCount = width * height;
  const fits = usedTexelCount <= capacityTexelCount;
  return Object.freeze({
    layoutName: BVH_PACKED_LAYOUT_NAME,
    width,
    height,
    nodeCount,
    triangleCount,
    nodeTexelCount: nodeTexels,
    triangleRegionBaseTexel: nodeTexels,
    triangleTexelCount: triangleTexels,
    usedTexelCount,
    capacityTexelCount,


    usedRowCount: Math.max(1, Math.ceil(usedTexelCount / width)),
    fits,
    reason: fits
      ? ""
      : "the packed BVH needs " + usedTexelCount + " texels and this texture holds " + capacityTexelCount,
  });
}

export function nodeMinimumTexelIndex(nodeIndex) {
  return Math.max(0, Math.floor(Number(nodeIndex) || 0)) * TEXELS_PER_NODE;
}

export function nodeMaximumTexelIndex(nodeIndex) {
  return nodeMinimumTexelIndex(nodeIndex) + 1;
}

export function triangleVertexTexelIndex(layout, packedTriangleIndex, vertexIndex) {
  const base = layout && Number.isFinite(layout.triangleRegionBaseTexel) ? layout.triangleRegionBaseTexel : 0;
  const triangle = Math.max(0, Math.floor(Number(packedTriangleIndex) || 0));
  const vertex = Math.max(0, Math.floor(Number(vertexIndex) || 0));
  return base + triangle * TEXELS_PER_TRIANGLE + vertex;
}


export function texelColumnAndRow(width, texelIndex) {
  const safeWidth = Math.max(1, Math.floor(Number(width) || 1));
  const index = Math.max(0, Math.floor(Number(texelIndex) || 0));
  return { column: index % safeWidth, row: Math.floor(index / safeWidth) };
}


export function createBvhTexturePayload(request) {
  const settings = request || {};
  const problems = [];
  const layoutName = settings.layoutName || BVH_PACKED_LAYOUT_NAME;
  if (layoutName !== BVH_PACKED_LAYOUT_NAME) {
    problems.push(
      'unknown packed layout "' + layoutName + '": only ' + BVH_PACKED_LAYOUT_NAME + " is accepted",
    );
  }

  const nodesF32 = settings.nodesF32;
  const trianglesF32 = settings.trianglesF32;
  if (!(nodesF32 instanceof Float32Array)) {
    problems.push("nodesF32 must be the Float32Array produced by packBvhForGpu");
  }
  if (!(trianglesF32 instanceof Float32Array)) {
    problems.push("trianglesF32 must be the Float32Array produced by packBvhForGpu");
  }

  const nodeCount = wholeNumber(settings.nodeCount);
  const triangleCount = wholeNumber(settings.triangleCount);
  if (nodeCount === 0) problems.push("nodeCount is zero: there is no tree to traverse");
  if (problems.length > 0) {
    return Object.freeze({ ok: false, problems: Object.freeze(problems), layout: null, data: null });
  }

  if (nodesF32.length !== nodeCount * FLOATS_PER_PACKED_NODE) {
    problems.push(
      "nodesF32 holds " + nodesF32.length + " floats, but " + nodeCount + " nodes need " +
        nodeCount * FLOATS_PER_PACKED_NODE,
    );
  }
  if (trianglesF32.length !== triangleCount * FLOATS_PER_PACKED_TRIANGLE) {
    problems.push(
      "trianglesF32 holds " + trianglesF32.length + " floats, but " + triangleCount + " triangles need " +
        triangleCount * FLOATS_PER_PACKED_TRIANGLE,
    );
  }

  const layout = describeBvhTextureLayout({
    nodeCount,
    triangleCount,
    width: settings.width,
    height: settings.height,
  });
  if (!layout.fits) problems.push(layout.reason);


  const packedNodeMeta = new Uint32Array(nodesF32.buffer, nodesF32.byteOffset, nodesF32.length);
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
    const floatBase = nodeIndex * FLOATS_PER_PACKED_NODE;
    const firstOrRightChild = packedNodeMeta[floatBase + 3];
    const leafTriangleCount = packedNodeMeta[floatBase + 7];
    if (firstOrRightChild > MAXIMUM_EXACT_FLOAT_INTEGER || leafTriangleCount > MAXIMUM_EXACT_FLOAT_INTEGER) {
      problems.push(
        "node " + nodeIndex + " has a meta value above 2^24, which a float cannot represent exactly",
      );
      break;
    }
  }

  if (problems.length > 0) {
    return Object.freeze({ ok: false, problems: Object.freeze(problems), layout, data: null });
  }

  const data = new Float32Array(layout.width * layout.usedRowCount * CHANNELS_PER_TEXEL);
  for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
    const floatBase = nodeIndex * FLOATS_PER_PACKED_NODE;
    const minimumChannel = nodeMinimumTexelIndex(nodeIndex) * CHANNELS_PER_TEXEL;
    const maximumChannel = nodeMaximumTexelIndex(nodeIndex) * CHANNELS_PER_TEXEL;
    data[minimumChannel] = nodesF32[floatBase];
    data[minimumChannel + 1] = nodesF32[floatBase + 1];
    data[minimumChannel + 2] = nodesF32[floatBase + 2];
    data[minimumChannel + 3] = packedNodeMeta[floatBase + 3];
    data[maximumChannel] = nodesF32[floatBase + 4];
    data[maximumChannel + 1] = nodesF32[floatBase + 5];
    data[maximumChannel + 2] = nodesF32[floatBase + 6];
    data[maximumChannel + 3] = packedNodeMeta[floatBase + 7];
  }

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const sourceBase = triangleIndex * FLOATS_PER_PACKED_TRIANGLE + vertexIndex * CHANNELS_PER_TEXEL;
      const targetBase = triangleVertexTexelIndex(layout, triangleIndex, vertexIndex) * CHANNELS_PER_TEXEL;
      data[targetBase] = trianglesF32[sourceBase];
      data[targetBase + 1] = trianglesF32[sourceBase + 1];
      data[targetBase + 2] = trianglesF32[sourceBase + 2];
      data[targetBase + 3] = 0;
    }
  }

  return Object.freeze({
    ok: true,
    problems: Object.freeze([]),
    layout,
    data,
    nodeCount,
    triangleCount,
    rowCount: layout.usedRowCount,
    residuals: BVH_TEXTURE_RESIDUALS,
  });
}





export function readTexel(payload, texelIndex, out) {
  const target = out || [0, 0, 0, 0];
  const data = payload ? payload.data : null;
  const base = Math.max(0, Math.floor(Number(texelIndex) || 0)) * CHANNELS_PER_TEXEL;
  for (let channel = 0; channel < CHANNELS_PER_TEXEL; channel++) {
    const value = data ? data[base + channel] : 0;
    target[channel] = Number.isFinite(value) ? value : 0;
  }
  return target;
}

export function describeBvhTexture(payload) {
  if (!payload || !payload.layout) return { available: false };
  return {
    available: !!payload.ok,
    layoutName: payload.layout.layoutName,
    width: payload.layout.width,
    height: payload.layout.height,
    usedRowCount: payload.layout.usedRowCount,
    nodeCount: payload.layout.nodeCount,
    triangleCount: payload.layout.triangleCount,
    usedTexelCount: payload.layout.usedTexelCount,
    capacityTexelCount: payload.layout.capacityTexelCount,
    megabytesOnGpu: (payload.layout.width * payload.layout.height * CHANNELS_PER_TEXEL * 4) / (1024 * 1024),
  };
}
