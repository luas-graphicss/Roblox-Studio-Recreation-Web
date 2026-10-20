import { saTintThrough } from "./shadowAtlasCore.js";
import { boxSmallestExtent, boxVolume } from "./llRaySlabCore.js";
import { TRANSMITTER_BOX_SLOTS, TRANSMITTER_REFUSALS } from "./llTransmissionContract.js";


export const MIN_TRANSMISSION = 0.02;

export const MIN_BOX_VOLUME = 1e-6;


export const MIN_BOX_THICKNESS_STUDS = 0.02;

export const DEFAULT_ABSORPTION_PER_STUD = 0.35;

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return number < 0 ? 0 : number > 1 ? 1 : number;
}


export function effectiveTransmission(descriptor) {
  const transmission = clamp01(descriptor && descriptor.transmission);
  if (transmission > 0) return transmission;
  const opacity = descriptor && Number.isFinite(descriptor.opacity) ? clamp01(descriptor.opacity) : 1;
  return descriptor && descriptor.transparent === true ? clamp01(1 - opacity) : 0;
}

function axisIsDegenerate(size, minThickness) {
  return !(size > minThickness);
}


export function inflateDegenerateAxes(box, minThickness) {
  const thickness = Number.isFinite(minThickness) ? minThickness : MIN_BOX_THICKNESS_STUDS;
  const sizes = [box.maxX - box.minX, box.maxY - box.minY, box.maxZ - box.minZ];
  const degenerateAxes = sizes.filter((size) => axisIsDegenerate(size, thickness)).length;
  const centers = [
    (box.minX + box.maxX) * 0.5,
    (box.minY + box.maxY) * 0.5,
    (box.minZ + box.maxZ) * 0.5,
  ];
  const half = sizes.map((size, index) => (axisIsDegenerate(sizes[index], thickness) ? thickness : size) * 0.5);
  return {
    degenerateAxes,
    box: {
      minX: centers[0] - half[0], maxX: centers[0] + half[0],
      minY: centers[1] - half[1], maxY: centers[1] + half[1],
      minZ: centers[2] - half[2], maxZ: centers[2] + half[2],
    },
  };
}

function boxIsFinite(box) {
  return !!box
    && Number.isFinite(box.minX) && Number.isFinite(box.maxX)
    && Number.isFinite(box.minY) && Number.isFinite(box.maxY)
    && Number.isFinite(box.minZ) && Number.isFinite(box.maxZ)
    && box.maxX >= box.minX && box.maxY >= box.minY && box.maxZ >= box.minZ;
}

export function isTransmitterCandidate(descriptor) {
  if (!descriptor) return false;
  if (descriptor.forced === true) return true;
  return effectiveTransmission(descriptor) >= MIN_TRANSMISSION;
}


export function transmitterTint(descriptor) {
  const color = (descriptor && descriptor.color) || [1, 1, 1];
  const transmission = clamp01(descriptor && descriptor.transmission);
  const thicknessStuds = Math.max(Number(descriptor && descriptor.thicknessStuds) || 0, 0);
  const absorptionPerStud = Number.isFinite(descriptor && descriptor.absorptionPerStud)
    ? Math.max(descriptor.absorptionPerStud, 0)
    : DEFAULT_ABSORPTION_PER_STUD;
  const density = Math.exp(-absorptionPerStud * thicknessStuds);
  return [
    clamp01(clamp01(color[0]) * transmission * density),
    clamp01(clamp01(color[1]) * transmission * density),
    clamp01(clamp01(color[2]) * transmission * density),
  ];
}


export function transmitterPriority(box, cameraPosition) {
  const volume = boxVolume(box);
  if (!Array.isArray(cameraPosition)) return volume;
  const dx = (box.minX + box.maxX) * 0.5 - cameraPosition[0];
  const dy = (box.minY + box.maxY) * 0.5 - cameraPosition[1];
  const dz = (box.minZ + box.maxZ) * 0.5 - cameraPosition[2];
  return volume / (1 + dx * dx + dy * dy + dz * dz);
}

export function collectTransmitterBoxes(options) {
  const settings = options || {};
  const candidates = Array.isArray(settings.candidates) ? settings.candidates : [];
  const slotCount = Number.isFinite(settings.slotCount) ? settings.slotCount : TRANSMITTER_BOX_SLOTS;
  const cameraPosition = settings.cameraPosition || null;
  const evaluated = [];
  const refusals = [];

  candidates.forEach((candidate) => {
    const name = (candidate && candidate.name) || "?";
    if (!isTransmitterCandidate(candidate)) {
      refusals.push({ name, refusal: TRANSMITTER_REFUSALS.notTransmissive });
      return;
    }
    if (!boxIsFinite(candidate.box)) {
      refusals.push({ name, refusal: TRANSMITTER_REFUSALS.emptyBox });
      return;
    }
    const inflated = inflateDegenerateAxes(candidate.box, MIN_BOX_THICKNESS_STUDS);
    const source = inflated.box;
    if (inflated.degenerateAxes >= 2 || boxVolume(source) < MIN_BOX_VOLUME) {
      refusals.push({ name, refusal: TRANSMITTER_REFUSALS.emptyBox });
      return;
    }
    const transmission = effectiveTransmission(candidate);
    const thicknessStuds = Number.isFinite(candidate.thicknessStuds)
      ? candidate.thicknessStuds
      : boxSmallestExtent(source);
    const tint = transmitterTint({
      color: candidate.color,
      transmission,
      thicknessStuds,
      absorptionPerStud: candidate.absorptionPerStud,
    });
    evaluated.push({
      name,
      transmission,
      thicknessStuds,
      tint,
      priority: transmitterPriority(source, cameraPosition),
      object: candidate.object || null,
      box: {
        minX: source.minX, minY: source.minY, minZ: source.minZ,
        maxX: source.maxX, maxY: source.maxY, maxZ: source.maxZ,
        r: tint[0], g: tint[1], b: tint[2],
      },
    });
  });

  evaluated.sort((a, b) => b.priority - a.priority || String(a.name).localeCompare(String(b.name)));
  const accepted = evaluated.slice(0, Math.max(slotCount, 0));
  evaluated.slice(Math.max(slotCount, 0)).forEach((entry) => {
    refusals.push({ name: entry.name, refusal: TRANSMITTER_REFUSALS.overBudget });
  });

  return {
    slotCount,
    accepted,
    refusals,
    boxes: accepted.map((entry) => entry.box),
  };
}


export function tintAlongSegment(options) {
  const settings = options || {};
  const point = settings.point || [0, 0, 0];
  const lightPosition = settings.lightPosition || [0, 0, 0];
  const boxes = Array.isArray(settings.boxes) ? settings.boxes : [];
  const out = saTintThrough(
    point[0], point[1], point[2],
    lightPosition[0], lightPosition[1], lightPosition[2],
    boxes,
    { r: 1, g: 1, b: 1 },
  );
  return [out.r, out.g, out.b];
}

export function tintIsNeutral(tint, epsilon) {
  const tolerance = Number.isFinite(epsilon) ? epsilon : 1e-6;
  return Math.abs(tint[0] - 1) <= tolerance
    && Math.abs(tint[1] - 1) <= tolerance
    && Math.abs(tint[2] - 1) <= tolerance;
}


export function tintChroma(tint) {
  const maxChannel = Math.max(tint[0], tint[1], tint[2]);
  const minChannel = Math.min(tint[0], tint[1], tint[2]);
  return maxChannel <= 0 ? 0 : (maxChannel - minChannel) / maxChannel;
}
