import { MSM_GRID_MAX_LIGHT_COUNT, createWorldGridLayout } from "./msmWorldGridLayout.js";


export const MSM_CONSTANT_PREFIX = "MSM_";


export const MSM_TELEMETRY_KEY = "megaLightsSm";
export const MSM_QA_GLOBAL_NAME = "__rswMsm";


export const MSM_SAMPLE_PASS_ID = "msm-sample";
export const MSM_TEMPORAL_PASS_ID = "msm-temporal";
export const MSM_SPATIAL_PASS_ID = "msm-spatial";
export const MSM_PASS_IDS = Object.freeze([MSM_SAMPLE_PASS_ID, MSM_TEMPORAL_PASS_ID, MSM_SPATIAL_PASS_ID]);


export const MSM_COMPOSITE_MODE_SCREEN = "A";
export const MSM_COMPOSITE_MODE_INJECTION = "B";
export const MSM_COMPOSITE_MODES = Object.freeze([MSM_COMPOSITE_MODE_SCREEN, MSM_COMPOSITE_MODE_INJECTION]);


export const MSM_PASS_TEXTURE_UNIT_LIMIT = 8;
export const MSM_MATERIAL_TEXTURE_UNIT_LIMIT = 1;
export const MSM_NEW_VRAM_CEILING_BYTES = 1536 * 1024;


export const MSM_MAX_LIGHT_COUNT = MSM_GRID_MAX_LIGHT_COUNT;
export const MSM_TEXELS_PER_LIGHT = 4;


export const MSM_RESOLUTION_DIVISORS = Object.freeze([2, 4]);
export const MSM_DEFAULT_RESOLUTION_DIVISOR = 2;


export const MSM_GRID_LADDER_MAX = Object.freeze({ cellsX: 32, cellsY: 8, cellsZ: 32, maxListsPerCell: 12 });


export const MSM_GRID_LAYOUT_CEILING = createWorldGridLayout(MSM_GRID_LADDER_MAX);


export const MSM_SHARED_DEPTH_HALF_BUFFER_ID = "sharedDepthHalf";
export const MSM_SHADOW_ATLAS_BUFFER_ID = "shadowAtlas";
export const MSM_SHADOW_ATLAS_META_BUFFER_ID = "shadowAtlasMeta";
export const MSM_LIGHT_DATA_BUFFER_ID = "msmLightData";
export const MSM_GRID_TEXTURE_BUFFER_ID = "msmGridTexture";
export const MSM_BLUE_NOISE_BUFFER_ID = "msmBlueNoise";
export const MSM_IRRADIANCE_CURRENT_BUFFER_ID = "msmIrradianceCurrent";
export const MSM_IRRADIANCE_HISTORY_BUFFER_ID = "msmIrradianceHistory";
export const MSM_VARIANCE_MOMENTS_BUFFER_ID = "msmVarianceMoments";

const BLUE_NOISE_TEXEL_COUNT = 64 * 64 * 8;                                     

const BUFFER_DESCRIPTORS = Object.freeze([
  Object.freeze({
    id: MSM_SHARED_DEPTH_HALF_BUFFER_ID,
    format: "depth de meia-res (sharedDepth)",
    sizeMode: "preExisting",
    bytesPerTexel: 0,
    texelCount: 0,
    instances: 1,
    mipLevels: 1,
    purpose: "posicao de vista e marcha screen-space (§2.1: reuso, nao copia)",
  }),
  Object.freeze({
    id: MSM_SHADOW_ATLAS_BUFFER_ID,
    format: "atlas de sombras existente",
    sizeMode: "preExisting",
    bytesPerTexel: 0,
    texelCount: 0,
    instances: 1,
    mipLevels: 1,
    purpose: "visibilidade das luzes residentes (shadowAtlasCore, congelado)",
  }),
  Object.freeze({
    id: MSM_SHADOW_ATLAS_META_BUFFER_ID,
    format: "meta do atlas (slot, matriz, validade)",
    sizeMode: "preExisting",
    bytesPerTexel: 0,
    texelCount: 0,
    instances: 1,
    mipLevels: 1,
    purpose: "achar o slot da luz sorteada sem recompilar shader",
  }),
  Object.freeze({
    id: MSM_LIGHT_DATA_BUFFER_ID,
    format: "RGBA16F",
    sizeMode: "fixed",
    bytesPerTexel: 8,
    texelCount: MSM_MAX_LIGHT_COUNT * MSM_TEXELS_PER_LIGHT,
    instances: 1,
    mipLevels: 1,
    purpose: "4 texeis por luz: pos+range, cor+intensidade, dir+cosOuter, extras",
  }),
  Object.freeze({
    id: MSM_GRID_TEXTURE_BUFFER_ID,
    format: "RGBA8",
    sizeMode: "fixed",
    bytesPerTexel: 4,
    texelCount: MSM_GRID_LAYOUT_CEILING.allocatedTexelCount,
    instances: 1,
    mipLevels: 1,
    purpose: "cabecalho + listas de luz por celula (msmWorldGridLayout manda)",
  }),
  Object.freeze({
    id: MSM_BLUE_NOISE_BUFFER_ID,
    format: "RGBA8",
    sizeMode: "fixed",
    bytesPerTexel: 4,
    texelCount: BLUE_NOISE_TEXEL_COUNT,
    instances: 1,
    mipLevels: 1,
    purpose: "cursor deterministico do sorteio (F11/F12)",
  }),
  Object.freeze({
    id: MSM_IRRADIANCE_CURRENT_BUFFER_ID,
    format: "RG11B10F (fallback RGBA8 com escala)",
    sizeMode: "reduced",
    bytesPerTexel: 4,
    texelCount: 0,
    instances: 1,
    mipLevels: 1,
    purpose: "irradiancia crua do quadro, saida do P1",
  }),
  Object.freeze({
    id: MSM_IRRADIANCE_HISTORY_BUFFER_ID,
    format: "RG11B10F ping-pong com 1 mip",
    sizeMode: "reduced",
    bytesPerTexel: 4,
    texelCount: 0,
    instances: 2,
    mipLevels: 2,
    purpose: "historia acumulada; o forward do quadro seguinte le daqui",
  }),
  Object.freeze({
    id: MSM_VARIANCE_MOMENTS_BUFFER_ID,
    format: "RG16F",
    sizeMode: "reduced",
    bytesPerTexel: 4,
    texelCount: 0,
    instances: 1,
    mipLevels: 1,
    purpose: "momentos para o portao de variancia RELATIVA do P3 (§7 regra 14)",
  }),
]);



const PASS_DESCRIPTORS = Object.freeze([
  Object.freeze({
    id: MSM_SAMPLE_PASS_ID,
    order: 1,
    shortName: "P1",
    role: "sorteio estocastico de 1 emissor por pixel + visibilidade barata",
    runsAtReducedResolution: true,
    budgetTargetMs: 1,
    requiredBufferIds: Object.freeze([
      MSM_SHARED_DEPTH_HALF_BUFFER_ID,
      MSM_GRID_TEXTURE_BUFFER_ID,
      MSM_LIGHT_DATA_BUFFER_ID,
      MSM_BLUE_NOISE_BUFFER_ID,
      MSM_SHADOW_ATLAS_BUFFER_ID,
      MSM_SHADOW_ATLAS_META_BUFFER_ID,
    ]),
    writesBufferId: MSM_IRRADIANCE_CURRENT_BUFFER_ID,
  }),
  Object.freeze({
    id: MSM_TEMPORAL_PASS_ID,
    order: 2,
    shortName: "P2",
    role: "acumulo temporal com reprojecao e rejeicao por profundidade",
    runsAtReducedResolution: true,
    budgetTargetMs: 0.25,
    requiredBufferIds: Object.freeze([
      MSM_IRRADIANCE_CURRENT_BUFFER_ID,
      MSM_IRRADIANCE_HISTORY_BUFFER_ID,
      MSM_SHARED_DEPTH_HALF_BUFFER_ID,
    ]),
    writesBufferId: MSM_IRRADIANCE_HISTORY_BUFFER_ID,
  }),
  Object.freeze({
    id: MSM_SPATIAL_PASS_ID,
    order: 3,
    shortName: "P3",
    role: "filtro espacial de 5 taps atras do portao de variancia relativa",
    runsAtReducedResolution: true,
    budgetTargetMs: 0.25,
    requiredBufferIds: Object.freeze([
      MSM_IRRADIANCE_HISTORY_BUFFER_ID,
      MSM_VARIANCE_MOMENTS_BUFFER_ID,
      MSM_SHARED_DEPTH_HALF_BUFFER_ID,
    ]),
    writesBufferId: MSM_IRRADIANCE_HISTORY_BUFFER_ID,
  }),
]);


const PATCH_SLOT_DESCRIPTORS = Object.freeze([
  Object.freeze({
    id: "msm-screen-composite",
    compositeMode: MSM_COMPOSITE_MODE_SCREEN,
    ownerPhase: "MSM-F22",
    materialTextureUnitCost: 0,
    readsBufferId: MSM_IRRADIANCE_HISTORY_BUFFER_ID,
    target: "passe de tela depois do RenderPass (nada de material tocado)",
  }),
  Object.freeze({
    id: "msm-forward-injection",
    compositeMode: MSM_COMPOSITE_MODE_INJECTION,
    ownerPhase: "MSM-F24",
    materialTextureUnitCost: 1,
    readsBufferId: MSM_IRRADIANCE_HISTORY_BUFFER_ID,
    target: "material forward: irradiancia vezes cor difusa, via extraGlobalTextures",
  }),
]);

function toPositiveInteger(value, fallback) {
  const parsed = Math.floor(Number(value));
  return parsed >= 1 ? parsed : fallback;
}


function resolveMipFactor(mipLevels) {
  const levels = toPositiveInteger(mipLevels, 1);
  let factor = 0;
  let scale = 1;
  let level = 0;
  while (levels > level) {
    factor += scale;
    scale /= 4;
    level += 1;
  }
  return factor;
}

function resolveBufferBytes(descriptor, reducedPixelCount) {
  if (descriptor.sizeMode === "preExisting") return 0;
  const texels = descriptor.sizeMode === "reduced" ? reducedPixelCount : descriptor.texelCount;
  const bytes = texels * descriptor.bytesPerTexel * resolveMipFactor(descriptor.mipLevels);
  return Math.ceil(bytes) * toPositiveInteger(descriptor.instances, 1);
}


export function listBuffers() {
  return BUFFER_DESCRIPTORS.slice();
}


export function findBuffer(bufferId) {
  return BUFFER_DESCRIPTORS.find((buffer) => buffer.id === bufferId) || null;
}


export function listPasses() {
  return PASS_DESCRIPTORS.slice();
}


export function findPass(passId) {
  return PASS_DESCRIPTORS.find((pass) => pass.id === passId) || null;
}


export function countPassTextureUnits(passId) {
  const pass = findPass(passId);
  return pass ? pass.requiredBufferIds.length : 0;
}


export function listPatchSlots() {
  return PATCH_SLOT_DESCRIPTORS.slice();
}


export function findPatchSlot(patchSlotId) {
  return PATCH_SLOT_DESCRIPTORS.find((slot) => slot.id === patchSlotId) || null;
}






export function resolveReducedResolution(request) {
  const source = request && typeof request === "object" ? request : {};
  const fullWidth = toPositiveInteger(source.width, 0);
  const fullHeight = toPositiveInteger(source.height, 0);
  const requestedDivisor = Math.floor(Number(source.divisor));
  const divisorAccepted = MSM_RESOLUTION_DIVISORS.indexOf(requestedDivisor) !== -1;
  const divisor = divisorAccepted ? requestedDivisor : MSM_DEFAULT_RESOLUTION_DIVISOR;
  const width = fullWidth >= 1 ? Math.ceil(fullWidth / divisor) : 0;
  const height = fullHeight >= 1 ? Math.ceil(fullHeight / divisor) : 0;
  return Object.freeze({
    fullWidth,
    fullHeight,
    requestedDivisor: Number.isFinite(requestedDivisor) ? requestedDivisor : 0,
    divisorAccepted,
    divisor,
    width,
    height,
    pixelCount: width * height,
    pixelFraction: 1 / (divisor * divisor),
    coverageCycleFrames: divisor * divisor,
  });
}







export function resolveBufferPlan(request) {
  const resolution = resolveReducedResolution(request);
  const buffers = BUFFER_DESCRIPTORS.map((descriptor) =>
    Object.freeze({
      id: descriptor.id,
      sizeMode: descriptor.sizeMode,
      format: descriptor.format,
      instances: descriptor.instances,
      bytes: resolveBufferBytes(descriptor, resolution.pixelCount),
    }),
  );
  const fixedVramBytes = buffers
    .filter((buffer) => buffer.sizeMode === "fixed")
    .reduce((total, buffer) => total + buffer.bytes, 0);
  const reducedVramBytes = buffers
    .filter((buffer) => buffer.sizeMode === "reduced")
    .reduce((total, buffer) => total + buffer.bytes, 0);
  const bytesPerReducedPixel = BUFFER_DESCRIPTORS.filter((descriptor) => descriptor.sizeMode === "reduced").reduce(
    (total, descriptor) =>
      total + descriptor.bytesPerTexel * resolveMipFactor(descriptor.mipLevels) * descriptor.instances,
    0,
  );
  const newVramBytes = fixedVramBytes + reducedVramBytes;
  const remainingBytes = MSM_NEW_VRAM_CEILING_BYTES - fixedVramBytes;
  const maxReducedPixelCount =
    bytesPerReducedPixel > 0 ? Math.max(0, Math.floor(remainingBytes / bytesPerReducedPixel)) : 0;
  return Object.freeze({
    resolution,
    buffers: Object.freeze(buffers),
    fixedVramBytes,
    reducedVramBytes,
    newVramBytes,
    ceilingBytes: MSM_NEW_VRAM_CEILING_BYTES,
    withinVramCeiling: MSM_NEW_VRAM_CEILING_BYTES >= newVramBytes,
    bytesPerReducedPixel,
    maxReducedPixelCount,
  });
}


export function validatePipelineContract() {
  const problems = [];
  const seenPassIds = new Set();

  PASS_DESCRIPTORS.forEach((pass, position) => {
    if (seenPassIds.has(pass.id)) problems.push("id de passe repetido: " + pass.id);
    seenPassIds.add(pass.id);
    if (pass.order !== position + 1) problems.push("ordem fora de sequencia no passe " + pass.id);
    if (MSM_PASS_IDS[position] !== pass.id) problems.push("MSM_PASS_IDS fora de sincronia em " + pass.id);
    if (pass.requiredBufferIds.length > MSM_PASS_TEXTURE_UNIT_LIMIT) {
      problems.push(pass.id + " amarra " + pass.requiredBufferIds.length + " unidades de textura");
    }
    pass.requiredBufferIds.forEach((bufferId) => {
      if (!findBuffer(bufferId)) problems.push(pass.id + " le buffer nao declarado: " + bufferId);
    });
    if (!findBuffer(pass.writesBufferId)) {
      problems.push(pass.id + " escreve buffer nao declarado: " + pass.writesBufferId);
    }
  });

  if (MSM_PASS_IDS.length !== PASS_DESCRIPTORS.length) problems.push("MSM_PASS_IDS com tamanho diferente dos passes");

  const materialTextureUnits = PATCH_SLOT_DESCRIPTORS.reduce(
    (total, slot) => Math.max(total, slot.materialTextureUnitCost),
    0,
  );
  if (materialTextureUnits > MSM_MATERIAL_TEXTURE_UNIT_LIMIT) {
    problems.push("slot de patch pede " + materialTextureUnits + " unidades no material");
  }

  MSM_COMPOSITE_MODES.forEach((mode) => {
    const slots = PATCH_SLOT_DESCRIPTORS.filter((slot) => slot.compositeMode === mode);
    if (slots.length !== 1) problems.push("modo de composicao " + mode + " tem " + slots.length + " slots");
  });

  MSM_RESOLUTION_DIVISORS.forEach((divisor) => {
    if (!(divisor >= 2)) problems.push("divisor invalido: " + divisor);
  });

  if (!MSM_GRID_LAYOUT_CEILING.withinOffsetBudget) {
    problems.push("grid do teto nao cabe nos 16 bits de offset do cabecalho");
  }

  return { ok: problems.length === 0, problems };
}


export function describePipelineContract() {
  return {
    passes: PASS_DESCRIPTORS.map((pass) => ({
      id: pass.id,
      order: pass.order,
      shortName: pass.shortName,
      textureUnits: pass.requiredBufferIds.length,
      budgetTargetMs: pass.budgetTargetMs,
      writesBufferId: pass.writesBufferId,
    })),
    compositeModes: MSM_COMPOSITE_MODES.slice(),
    patchSlots: PATCH_SLOT_DESCRIPTORS.map((slot) => ({
      id: slot.id,
      compositeMode: slot.compositeMode,
      ownerPhase: slot.ownerPhase,
      materialTextureUnitCost: slot.materialTextureUnitCost,
    })),
    resolutionDivisors: MSM_RESOLUTION_DIVISORS.slice(),
    maxLightCount: MSM_MAX_LIGHT_COUNT,
    gridTexture: MSM_GRID_LAYOUT_CEILING.textureWidth + "x" + MSM_GRID_LAYOUT_CEILING.textureHeight,
    passTextureUnitLimit: MSM_PASS_TEXTURE_UNIT_LIMIT,
    materialTextureUnitLimit: MSM_MATERIAL_TEXTURE_UNIT_LIMIT,
    newVramCeilingBytes: MSM_NEW_VRAM_CEILING_BYTES,
    valid: validatePipelineContract().ok,
  };
}
