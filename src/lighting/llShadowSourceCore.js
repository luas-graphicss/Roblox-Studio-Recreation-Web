import { diffuseSourceRadius } from "./llSourceShapeCore.js";

export const ENGINE_PCSS_MAX_SEARCH_UV = 0.05;
export const ENGINE_PCSS_MAX_FILTER_UV = 0.033;
export const ENGINE_PCSS_MIN_FILTER_TEXELS = 1;


export const SPOT_SHADOW_NEAR = 0.5;
export const SPOT_SHADOW_FALLBACK_FAR = 500;
export const MIN_SPOT_SHADOW_SPAN = 0.01;


export const PENUMBRA_TEN_TO_NINETY_FACTOR = 0.687;

export const LOCAL_SHADOW_SOURCE_KIND = Object.freeze({
  sphere: "sphere",
  capsule: "capsule",
  rect: "rect",
});

const RECT_LIGHT_TYPES = Object.freeze(["RectLight", "SurfaceLight"]);
const TUBE_LIGHT_TYPE = "TubeLight";
const MIN_POSITIVE = 1e-6;

function isFiniteNumber(value) {
  return typeof value === "number" && isFinite(value);
}

function positiveOrZero(value) {
  const number = Number(value);
  return isFiniteNumber(number) && number > 0 ? number : 0;
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}


export function resolveLocalShadowSource(light) {
  const input = light || {};
  const props = input.props || {};
  const type = String(input.type || "PointLight");
  const sourceRadius = diffuseSourceRadius({
    sourceRadius: positiveOrZero(props.SourceRadius),
    softSourceRadius: positiveOrZero(props.SoftSourceRadius),
  });
  const sourceLength = positiveOrZero(props.SourceLength);
  const filterSharpen = clamp(positiveOrZero(props.FilterSharpen), 0, 1);
  const slopeBias = positiveOrZero(props.ShadowSlopeBias);

  let kind = LOCAL_SHADOW_SOURCE_KIND.sphere;
  let halfMajorExtent = sourceRadius;
  let halfMinorExtent = sourceRadius;

  if (RECT_LIGHT_TYPES.indexOf(type) >= 0) {
    const width = positiveOrZero(props.Width);
    const height = positiveOrZero(props.Height);
    kind = LOCAL_SHADOW_SOURCE_KIND.rect;
    halfMajorExtent = Math.max(Math.max(width, height) / 2, sourceRadius);
    halfMinorExtent = Math.max(Math.min(width, height) / 2, sourceRadius);
  } else if (type === TUBE_LIGHT_TYPE || sourceLength > 0) {
    kind = LOCAL_SHADOW_SOURCE_KIND.capsule;


    halfMajorExtent = sourceRadius + sourceLength / 2;
    halfMinorExtent = sourceRadius;
  }

  const equivalentRadius = Math.sqrt(Math.max(halfMajorExtent, 0) * Math.max(halfMinorExtent, 0));
  return Object.freeze({
    kind: kind,
    sourceRadius: sourceRadius,
    sourceLength: sourceLength,
    halfMajorExtent: halfMajorExtent,
    halfMinorExtent: halfMinorExtent,
    equivalentRadius: equivalentRadius,
    anisotropy: halfMinorExtent > MIN_POSITIVE ? halfMajorExtent / halfMinorExtent : 1,
    filterSharpen: filterSharpen,
    slopeBias: slopeBias,
    castsPenumbra: equivalentRadius > 0,
  });
}


export function spotShadowCameraFor(spot) {
  const input = spot || {};
  const halfFovRad = positiveOrZero(input.angleRad);
  const far = positiveOrZero(input.range) || SPOT_SHADOW_FALLBACK_FAR;
  const near = SPOT_SHADOW_NEAR;
  return Object.freeze({
    halfFovRad: halfFovRad,
    near: near,
    far: Math.max(far, near + MIN_SPOT_SHADOW_SPAN),
  });
}


export function normalizedShadowDepth(distance, near, far) {
  const t = positiveOrZero(distance);
  const n = positiveOrZero(near);
  const f = positiveOrZero(far);
  if (!(t > 0) || !(f > n) || !(n > 0)) return 0;
  return (f / (f - n)) * (1 - n / t);
}


export function shadowDistanceForNormalizedDepth(depth, near, far) {
  const z = Number(depth);
  const n = positiveOrZero(near);
  const f = positiveOrZero(far);
  if (!isFiniteNumber(z) || !(f > n) || !(n > 0)) return 0;
  const denominator = f - z * (f - n);
  if (!(Math.abs(denominator) > MIN_POSITIVE)) return 0;
  return (n * f) / denominator;
}


export function texelWorldSizeFor(sample) {
  const input = sample || {};
  const distance = positiveOrZero(input.distance);
  const halfFovRad = positiveOrZero(input.halfFovRad);
  const mapSize = positiveOrZero(input.mapSize);
  if (!(distance > 0) || !(halfFovRad > 0) || !(mapSize > 0)) return 0;
  return (2 * distance * Math.tan(halfFovRad)) / mapSize;
}


export function sourceTexelScaleFor(source) {
  const input = source || {};
  const sourceRadius = positiveOrZero(input.sourceRadius);
  const mapSize = positiveOrZero(input.mapSize);
  const halfFovRad = positiveOrZero(input.halfFovRad);
  const near = positiveOrZero(input.near);
  const far = positiveOrZero(input.far);
  if (!(sourceRadius > 0) || !(mapSize > 0) || !(halfFovRad > 0)) return 0;
  if (!(far > near) || !(near > 0)) return 0;
  const denominator = 2 * Math.tan(halfFovRad) * near * far;
  if (!(denominator > MIN_POSITIVE)) return 0;
  return (sourceRadius * mapSize * (far - near)) / denominator;
}


export function filterSharpenScale(filterSharpen) {
  return 1 - clamp(positiveOrZero(filterSharpen), 0, 1);
}


export function penumbraWorldWidth(sample) {
  const input = sample || {};
  const sourceRadius = positiveOrZero(input.sourceRadius);
  const occluderDistance = positiveOrZero(input.occluderDistance);
  const receiverDistance = positiveOrZero(input.receiverDistance);
  if (!(sourceRadius > 0) || !(occluderDistance > 0)) return 0;
  if (!(receiverDistance > occluderDistance)) return 0;
  return (2 * sourceRadius * (receiverDistance - occluderDistance)) / occluderDistance;
}


export function filterTexelRadiusFor(sample) {
  const input = sample || {};
  const sourceTexelScale = positiveOrZero(input.sourceTexelScale);
  const receiverDepth = Number(input.receiverDepth);
  const blockerDepth = Number(input.blockerDepth);
  if (!(sourceTexelScale > 0) || !isFiniteNumber(receiverDepth) || !isFiniteNumber(blockerDepth)) return 0;
  return Math.max(0, sourceTexelScale * (receiverDepth - blockerDepth));
}


export function clampFilterTexelRadius(filterTexelRadius, mapSize) {
  const size = positiveOrZero(mapSize);
  const ceiling = size > 0 ? ENGINE_PCSS_MAX_FILTER_UV * size : ENGINE_PCSS_MIN_FILTER_TEXELS;
  return clamp(positiveOrZero(filterTexelRadius), ENGINE_PCSS_MIN_FILTER_TEXELS, Math.max(ceiling, ENGINE_PCSS_MIN_FILTER_TEXELS));
}


export function searchTexelRadiusFor(sample) {
  const input = sample || {};
  const sourceTexelScale = positiveOrZero(input.sourceTexelScale);
  const receiverDepth = positiveOrZero(input.receiverDepth);
  const mapSize = positiveOrZero(input.mapSize);
  if (!(sourceTexelScale > 0) || !(receiverDepth > 0) || !(mapSize > 0)) return 0;
  return Math.min(sourceTexelScale * receiverDepth, ENGINE_PCSS_MAX_SEARCH_UV * mapSize);
}


export function tenToNinetyWidthTexels(filterTexelRadius) {
  return 2 * positiveOrZero(filterTexelRadius) * PENUMBRA_TEN_TO_NINETY_FACTOR;
}


export function diskOccludedAreaFraction(u) {
  const clamped = clamp(Number(u) || 0, -1, 1);
  return (Math.acos(clamped) - clamped * Math.sqrt(Math.max(0, 1 - clamped * clamped))) / Math.PI;
}


export function describeLocalShadowPenumbra(input) {
  const options = input || {};
  const source = resolveLocalShadowSource(options.light);
  const camera = spotShadowCameraFor({ angleRad: options.angleRad, range: options.range });
  const mapSize = positiveOrZero(options.mapSize);
  const geometricTexelScale = sourceTexelScaleFor({
    sourceRadius: source.equivalentRadius,
    mapSize: mapSize,
    halfFovRad: camera.halfFovRad,
    near: camera.near,
    far: camera.far,
  });
  const sourceTexelScale = geometricTexelScale * filterSharpenScale(source.filterSharpen);
  return Object.freeze({
    source: source,
    camera: camera,
    mapSize: mapSize,
    geometricTexelScale: geometricTexelScale,
    sourceTexelScale: sourceTexelScale,
    slopeBias: source.slopeBias,
    filterSharpen: source.filterSharpen,
    hasPenumbra: sourceTexelScale > 0,
  });
}


export function buildPenumbraRuler(input) {
  const options = input || {};
  const penumbra = options.penumbra || {};
  const camera = penumbra.camera || spotShadowCameraFor({});
  const source = penumbra.source || {};
  const occluderDistance = positiveOrZero(options.occluderDistance);
  const receiverDistances = Array.isArray(options.receiverDistances) ? options.receiverDistances : [];
  const sourceTexelScale = positiveOrZero(options.sourceTexelScale === undefined ? penumbra.sourceTexelScale : options.sourceTexelScale);
  const sharpenedRadius = positiveOrZero(source.equivalentRadius) * filterSharpenScale(source.filterSharpen);
  const blockerDepth = normalizedShadowDepth(occluderDistance, camera.near, camera.far);
  return receiverDistances.map((receiverDistance) => {
    const distance = positiveOrZero(receiverDistance);
    const receiverDepth = normalizedShadowDepth(distance, camera.near, camera.far);
    const texelWorldSize = texelWorldSizeFor({ distance: distance, halfFovRad: camera.halfFovRad, mapSize: penumbra.mapSize });
    const filterTexelRadius = filterTexelRadiusFor({ sourceTexelScale: sourceTexelScale, receiverDepth: receiverDepth, blockerDepth: blockerDepth });
    const referenceWorldWidth = penumbraWorldWidth({
      sourceRadius: sharpenedRadius,
      occluderDistance: occluderDistance,
      receiverDistance: distance,
    });
    const shaderWorldWidth = 2 * filterTexelRadius * texelWorldSize;
    return Object.freeze({
      occluderDistance: occluderDistance,
      receiverDistance: distance,
      blockerDepth: blockerDepth,
      receiverDepth: receiverDepth,
      texelWorldSize: texelWorldSize,
      filterTexelRadius: filterTexelRadius,
      clampedFilterTexelRadius: clampFilterTexelRadius(filterTexelRadius, penumbra.mapSize),
      tenToNinetyTexels: tenToNinetyWidthTexels(filterTexelRadius),
      referenceWorldWidth: referenceWorldWidth,
      shaderWorldWidth: shaderWorldWidth,
      relativeError: referenceWorldWidth > 0 ? Math.abs(shaderWorldWidth - referenceWorldWidth) / referenceWorldWidth : 0,
    });
  });
}
