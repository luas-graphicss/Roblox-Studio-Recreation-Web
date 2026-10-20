export const MGL_LIGHT_SHAPE_INDEX = Object.freeze({ sphere: 0, rect: 1, tube: 2 });
export const MGL_LIGHT_SHAPE_NAMES = Object.freeze(["sphere", "rect", "tube"]);


export const MGL_LIGHT_SHAPE_BIT_COUNT = 3;
export const MGL_LIGHT_SHAPE_MASK = (1 << MGL_LIGHT_SHAPE_BIT_COUNT) - 1;


export const MGL_LIGHT_FLAG = Object.freeze({
  castsShadow: 1 << 0,
  virtualShadowMap: 1 << 1,
  rayTraced: 1 << 2,
  hasLightFunction: 1 << 3,
  isSpot: 1 << 4,
  texturedSource: 1 << 5,
});
export const MGL_LIGHT_FLAG_BIT_COUNT = 6;
export const MGL_LIGHT_FLAG_MASK = (1 << MGL_LIGHT_FLAG_BIT_COUNT) - 1;


export const MGL_NO_ATLAS_SLOT = -1;
export const MGL_MAX_ATLAS_SLOT = 4094;


export const DEFAULT_SPHERE_SOURCE_RADIUS = 0.05;
export const DEFAULT_ATTENUATION_RADIUS = 12;

export const MINIMUM_SOURCE_SIZE = 1e-4;


export const MGL_INTENSITY_SOURCE = Object.freeze({
  photometricCandela: "photometricCandela",
  rendererIntensity: "rendererIntensity",
});


export const MGL_NO_CONE_COSINE = -1;

const LIGHT_KIND_TO_SHAPE_NAME = Object.freeze({
  point: "sphere",
  pointlight: "sphere",
  sphere: "sphere",
  spot: "sphere",
  spotlight: "sphere",
  rect: "rect",
  rectangle: "rect",
  rectarealight: "rect",
  area: "rect",
  tube: "tube",
  cylinder: "tube",
});

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value, minimum, maximum) {
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}


export function shapeIndexForKind(kindOrShapeName) {
  const key = String(kindOrShapeName || "").toLowerCase();
  const shapeName = LIGHT_KIND_TO_SHAPE_NAME[key];
  if (!shapeName) return -1;
  return MGL_LIGHT_SHAPE_INDEX[shapeName];
}

export function shapeNameForIndex(shapeIndex) {
  return MGL_LIGHT_SHAPE_NAMES[shapeIndex] || null;
}

export function isSpotKind(kindName) {
  const key = String(kindName || "").toLowerCase();
  return key === "spot" || key === "spotlight";
}

export function hasFlag(flags, flag) {
  return (Number(flags) & Number(flag)) !== 0;
}

export function withFlag(flags, flag, isSet) {
  return isSet ? Number(flags) | Number(flag) : Number(flags) & ~Number(flag);
}


export function createLightDescriptor() {
  return {

    lightId: 0,
    slotIndex: -1,
    generation: 0,

    shapeIndex: MGL_LIGHT_SHAPE_INDEX.sphere,
    positionView: [0, 0, 0],
    attenuationRadius: DEFAULT_ATTENUATION_RADIUS,
    color: [1, 1, 1],
    intensityCandela: 0,
    intensitySource: MGL_INTENSITY_SOURCE.rendererIntensity,
    directionView: [0, 0, -1],
    coneCosOuter: MGL_NO_CONE_COSINE,
    coneCosInner: MGL_NO_CONE_COSINE,
    sourceRadiusOrWidth: DEFAULT_SPHERE_SOURCE_RADIUS,
    sourceLengthOrHeight: 0,
    flags: 0,
    atlasSlot: MGL_NO_ATLAS_SLOT,
    functionSlot: MGL_NO_ATLAS_SLOT,
  };
}


export function assignLightDescriptor(descriptor, input) {
  const source = input && typeof input === "object" ? input : {};

  const shapeIndexFromName =
    source.shapeIndex === undefined
      ? shapeIndexForKind(source.shape || source.kind)
      : Math.round(finiteNumberOrFallback(source.shapeIndex, -1));
  descriptor.shapeIndex =
    shapeIndexFromName >= 0 && shapeIndexFromName <= MGL_LIGHT_SHAPE_MASK
      ? shapeIndexFromName
      : MGL_LIGHT_SHAPE_INDEX.sphere;

  const position = source.positionView || source.position || [0, 0, 0];
  descriptor.positionView[0] = finiteNumberOrFallback(position[0], 0);
  descriptor.positionView[1] = finiteNumberOrFallback(position[1], 0);
  descriptor.positionView[2] = finiteNumberOrFallback(position[2], 0);

  descriptor.attenuationRadius = Math.max(
    finiteNumberOrFallback(source.attenuationRadius, DEFAULT_ATTENUATION_RADIUS),
    MINIMUM_SOURCE_SIZE,
  );

  const color = source.color || [1, 1, 1];
  descriptor.color[0] = Math.max(finiteNumberOrFallback(color[0], 1), 0);
  descriptor.color[1] = Math.max(finiteNumberOrFallback(color[1], 1), 0);
  descriptor.color[2] = Math.max(finiteNumberOrFallback(color[2], 1), 0);

  descriptor.intensityCandela = Math.max(finiteNumberOrFallback(source.intensityCandela, 0), 0);
  descriptor.intensitySource =
    source.intensitySource === MGL_INTENSITY_SOURCE.photometricCandela
      ? MGL_INTENSITY_SOURCE.photometricCandela
      : MGL_INTENSITY_SOURCE.rendererIntensity;

  const direction = source.directionView || source.direction || [0, 0, -1];
  descriptor.directionView[0] = finiteNumberOrFallback(direction[0], 0);
  descriptor.directionView[1] = finiteNumberOrFallback(direction[1], 0);
  descriptor.directionView[2] = finiteNumberOrFallback(direction[2], -1);

  descriptor.coneCosOuter = clampNumber(finiteNumberOrFallback(source.coneCosOuter, MGL_NO_CONE_COSINE), -1, 1);
  descriptor.coneCosInner = clampNumber(finiteNumberOrFallback(source.coneCosInner, MGL_NO_CONE_COSINE), -1, 1);

  const isRect = descriptor.shapeIndex === MGL_LIGHT_SHAPE_INDEX.rect;
  const defaultRadiusOrWidth = isRect ? 1 : DEFAULT_SPHERE_SOURCE_RADIUS;
  descriptor.sourceRadiusOrWidth = Math.max(
    finiteNumberOrFallback(
      source.sourceRadiusOrWidth === undefined ? source.sourceRadius : source.sourceRadiusOrWidth,
      defaultRadiusOrWidth,
    ),
    MINIMUM_SOURCE_SIZE,
  );
  descriptor.sourceLengthOrHeight = Math.max(
    finiteNumberOrFallback(
      source.sourceLengthOrHeight === undefined ? source.sourceLength : source.sourceLengthOrHeight,
      0,
    ),
    0,
  );

  descriptor.flags = Math.round(finiteNumberOrFallback(source.flags, 0)) & MGL_LIGHT_FLAG_MASK;
  descriptor.atlasSlot = clampNumber(
    Math.round(finiteNumberOrFallback(source.atlasSlot, MGL_NO_ATLAS_SLOT)),
    MGL_NO_ATLAS_SLOT,
    MGL_MAX_ATLAS_SLOT,
  );
  descriptor.functionSlot = clampNumber(
    Math.round(finiteNumberOrFallback(source.functionSlot, MGL_NO_ATLAS_SLOT)),
    MGL_NO_ATLAS_SLOT,
    MGL_MAX_ATLAS_SLOT,
  );


  descriptor.flags = withFlag(
    descriptor.flags,
    MGL_LIGHT_FLAG.hasLightFunction,
    descriptor.functionSlot !== MGL_NO_ATLAS_SLOT,
  );

  return descriptor;
}


export function normalizeLightDescriptor(input) {
  return assignLightDescriptor(createLightDescriptor(), input);
}

function vectorLength(vector) {
  return Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);
}


export function validateLightDescriptor(descriptor) {
  const problems = [];
  if (!descriptor || typeof descriptor !== "object") {
    return { valid: false, problems: ["descriptor is not an object"] };
  }

  if (
    !Number.isInteger(descriptor.shapeIndex) ||
    descriptor.shapeIndex < 0 ||
    descriptor.shapeIndex >= MGL_LIGHT_SHAPE_NAMES.length
  ) {
    problems.push("shapeIndex must be one of " + MGL_LIGHT_SHAPE_NAMES.join(", "));
  }

  ["positionView", "directionView", "color"].forEach((fieldName) => {
    const vector = descriptor[fieldName];
    if (!Array.isArray(vector) || vector.length !== 3 || !vector.every((value) => Number.isFinite(value))) {
      problems.push(fieldName + " must be three finite numbers");
    }
  });

  if (!(descriptor.attenuationRadius > 0)) problems.push("attenuationRadius must be greater than zero");
  if (!(descriptor.intensityCandela >= 0)) problems.push("intensityCandela must not be negative");

  if (!(descriptor.sourceRadiusOrWidth >= MINIMUM_SOURCE_SIZE)) {
    problems.push("sourceRadiusOrWidth below MINIMUM_SOURCE_SIZE: a zero area source is a delta light");
  }
  const needsSecondDimension =
    descriptor.shapeIndex === MGL_LIGHT_SHAPE_INDEX.rect ||
    descriptor.shapeIndex === MGL_LIGHT_SHAPE_INDEX.tube;
  if (needsSecondDimension && !(descriptor.sourceLengthOrHeight >= MINIMUM_SOURCE_SIZE)) {
    problems.push("sourceLengthOrHeight below MINIMUM_SOURCE_SIZE for " + shapeNameForIndex(descriptor.shapeIndex));
  }

  const isSpot = hasFlag(descriptor.flags, MGL_LIGHT_FLAG.isSpot);
  const needsDirection = isSpot || descriptor.shapeIndex !== MGL_LIGHT_SHAPE_INDEX.sphere;
  if (needsDirection && Array.isArray(descriptor.directionView)) {
    const length = vectorLength(descriptor.directionView);
    if (Math.abs(length - 1) > 1e-3) problems.push("directionView must be normalised for a spot, rect or tube light");
  }
  if (isSpot && !(descriptor.coneCosInner >= descriptor.coneCosOuter)) {
    problems.push("coneCosInner must be greater than or equal to coneCosOuter: the inner cone is the narrower one");
  }

  ["atlasSlot", "functionSlot"].forEach((fieldName) => {
    const slot = descriptor[fieldName];
    if (!Number.isInteger(slot) || slot < MGL_NO_ATLAS_SLOT || slot > MGL_MAX_ATLAS_SLOT) {
      problems.push(fieldName + " must be -1 or an integer up to " + MGL_MAX_ATLAS_SLOT);
    }
  });

  if ((descriptor.flags & ~MGL_LIGHT_FLAG_MASK) !== 0) problems.push("flags carry a bit outside MGL_LIGHT_FLAG");

  return { valid: problems.length === 0, problems };
}


export function lightDescriptorFieldNames() {
  return Object.keys(createLightDescriptor());
}
