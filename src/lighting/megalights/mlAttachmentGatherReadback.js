import { createFullScreenQuad, FULL_SCREEN_VERTEX_SHADER } from "./mlFullScreenQuad.js";
import {
  buildSurfaceGatherFragmentShader,
  SURFACE_GATHER_UNIFORM_NAMES,
} from "./mlSurfaceGatherGlsl.js";

const LOOKUP_TEXTURE_ROW_COUNT = 1;
const CHANNELS_PER_TEXEL = 4;
const NO_REVISION_UPLOADED = -1;

export function createAttachmentGatherReadback(dependencies) {
  const settings = dependencies || {};
  const THREE = settings.THREE || null;
  const renderer = settings.renderer || null;

  let fullScreenQuad = null;
  let gatherMaterial = null;
  let gatherTarget = null;
  let columnLookup = null;
  let rowLookup = null;
  let uploadedLatticeRevision = NO_REVISION_UPLOADED;
  let gatheredWidth = 0;
  let gatheredHeight = 0;
  let readCount = 0;

  function createLookupTexture(values, capacity) {
    const texture = new THREE.DataTexture(
      values,
      capacity,
      LOOKUP_TEXTURE_ROW_COUNT,
      THREE.RGBAFormat,
      THREE.FloatType,
    );


    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;

    texture.flipY = false;
    if (THREE.NoColorSpace !== undefined) texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function growLookup(existingLookup, requiredCapacity) {
    if (existingLookup && existingLookup.capacity >= requiredCapacity) return existingLookup;
    if (existingLookup && existingLookup.texture) existingLookup.texture.dispose();
    const values = new Float32Array(requiredCapacity * CHANNELS_PER_TEXEL);
    return {
      values,
      texture: createLookupTexture(values, requiredCapacity),
      capacity: requiredCapacity,
    };
  }

  function writeLookup(lookup, sourceCoordinates, coordinateCount) {
    const values = lookup.values;
    values.fill(0);
    for (let index = 0; index !== coordinateCount; index += 1) {
      values[index * CHANNELS_PER_TEXEL] = sourceCoordinates[index];
    }
    lookup.texture.needsUpdate = true;
  }

  function ensureProgram() {
    if (!fullScreenQuad) fullScreenQuad = createFullScreenQuad(THREE);
    if (gatherMaterial) return;
    gatherMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FULL_SCREEN_VERTEX_SHADER,
      fragmentShader: buildSurfaceGatherFragmentShader(),
      uniforms: {
        [SURFACE_GATHER_UNIFORM_NAMES.sourceAttachment]: { value: null },
        [SURFACE_GATHER_UNIFORM_NAMES.sourceColumns]: { value: null },
        [SURFACE_GATHER_UNIFORM_NAMES.sourceRows]: { value: null },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  function ensureGatherTarget(width, height) {
    if (!gatherTarget) {
      gatherTarget = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      return;
    }
    if (gatherTarget.width !== width || gatherTarget.height !== height) {
      gatherTarget.setSize(width, height);
    }
  }


  function read(request) {
    if (!THREE || !renderer) return null;
    const input = request || {};
    const sourceTexture = input.sourceTexture || null;
    const columnCount = Math.floor(Number(input.columnCount) || 0);
    const rowCount = Math.floor(Number(input.rowCount) || 0);
    const sourceColumns = input.sourceColumns || null;
    const sourceRows = input.sourceRows || null;
    if (!sourceTexture || !sourceColumns || !sourceRows) return null;
    if (!(columnCount >= 1) || !(rowCount >= 1)) return null;
    if (sourceColumns.length < columnCount || sourceRows.length < rowCount) return null;

    ensureProgram();
    columnLookup = growLookup(columnLookup, Math.max(columnCount, 1));
    rowLookup = growLookup(rowLookup, Math.max(rowCount, 1));

    const latticeRevision = Number(input.latticeRevision);
    const revisionIsUsable = Number.isFinite(latticeRevision);
    if (!revisionIsUsable || latticeRevision !== uploadedLatticeRevision) {
      writeLookup(columnLookup, sourceColumns, columnCount);
      writeLookup(rowLookup, sourceRows, rowCount);
      uploadedLatticeRevision = revisionIsUsable ? latticeRevision : NO_REVISION_UPLOADED;
    }

    ensureGatherTarget(columnCount, rowCount);
    gatherMaterial.uniforms[SURFACE_GATHER_UNIFORM_NAMES.sourceAttachment].value = sourceTexture;
    gatherMaterial.uniforms[SURFACE_GATHER_UNIFORM_NAMES.sourceColumns].value = columnLookup.texture;
    gatherMaterial.uniforms[SURFACE_GATHER_UNIFORM_NAMES.sourceRows].value = rowLookup.texture;
    fullScreenQuad.render(renderer, gatherMaterial, gatherTarget);

    const requiredFloatCount = columnCount * rowCount * CHANNELS_PER_TEXEL;
    const providedBuffer = input.pixelBuffer || null;
    const pixels =
      providedBuffer && providedBuffer.length >= requiredFloatCount
        ? providedBuffer
        : new Float32Array(requiredFloatCount);
    renderer.readRenderTargetPixels(gatherTarget, 0, 0, columnCount, rowCount, pixels);

    readCount += 1;
    gatheredWidth = columnCount;
    gatheredHeight = rowCount;
    return { pixels, width: columnCount, height: rowCount };
  }

  function dispose() {
    if (gatherTarget) gatherTarget.dispose();
    gatherTarget = null;
    if (gatherMaterial) gatherMaterial.dispose();
    gatherMaterial = null;
    if (fullScreenQuad) fullScreenQuad.dispose();
    fullScreenQuad = null;
    if (columnLookup && columnLookup.texture) columnLookup.texture.dispose();
    columnLookup = null;
    if (rowLookup && rowLookup.texture) rowLookup.texture.dispose();
    rowLookup = null;
    uploadedLatticeRevision = NO_REVISION_UPLOADED;
    gatheredWidth = 0;
    gatheredHeight = 0;
  }

  return {
    read,
    dispose,
    describe() {
      return {
        owner: "ML-F3",
        ready: Boolean(THREE && renderer),
        gatheredWidth,
        gatheredHeight,
        gatheredTexelCount: gatheredWidth * gatheredHeight,
        uploadedLatticeRevision,
        readCount,
      };
    },
  };
}
