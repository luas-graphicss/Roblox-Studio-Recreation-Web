export const GIZMO_CHANNELS = Object.freeze({
  OUTER_CONE: "outerCone",
  INNER_CONE: "innerCone",
  SOURCE_RADIUS: "sourceRadius",
  SOFT_SOURCE_RADIUS: "softSourceRadius",
  SOURCE_CAPSULE: "sourceCapsule",
  RECT_FRAME: "rectFrame",
  BARN_DOORS: "barnDoors",
});

export const GIZMO_CHANNEL_COLORS = Object.freeze({
  outerCone: 0xffb347,
  innerCone: 0xfff4d6,
  sourceRadius: 0x7fdfff,
  softSourceRadius: 0x4f8bff,
  sourceCapsule: 0x8ef0a5,
  rectFrame: 0xff8ad8,
  barnDoors: 0xff6a3d,
});


export const GIZMO_MAX_CONE_LENGTH = 16;
const CIRCLE_SEGMENTS = 32;
const CONE_RIB_COUNT = 4;
const DEG_TO_RAD = Math.PI / 180;
const MINIMUM_VISIBLE_SIZE = 0.0001;

function segment(fromX, fromY, fromZ, toX, toY, toZ) {
  return [fromX, fromY, fromZ, toX, toY, toZ];
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}





function circleSegments(radius, plane, offset) {
  if (radius <= MINIMUM_VISIBLE_SIZE) return [];
  const slide = Number.isFinite(offset) ? offset : 0;
  const points = [];
  for (let index = 0; index <= CIRCLE_SEGMENTS; index++) {
    const angle = (index / CIRCLE_SEGMENTS) * Math.PI * 2;
    const first = Math.cos(angle) * radius;
    const second = Math.sin(angle) * radius;
    if (plane === "xy") points.push([first, second, slide]);
    else if (plane === "xz") points.push([first, slide, second]);
    else points.push([slide, second, first]);
  }
  const segments = [];
  for (let index = 0; index < points.length - 1; index++) {
    const from = points[index];
    const to = points[index + 1];
    segments.push(segment(from[0], from[1], from[2], to[0], to[1], to[2]));
  }
  return segments;
}


function coneSegments(halfAngleDeg, length) {
  const halfAngle = positiveNumber(halfAngleDeg);
  const coneLength = Math.min(positiveNumber(length), GIZMO_MAX_CONE_LENGTH);
  if (halfAngle <= 0 || coneLength <= MINIMUM_VISIBLE_SIZE) return [];
  const clampedHalfAngle = Math.min(halfAngle, 89.5);
  const rimRadius = Math.tan(clampedHalfAngle * DEG_TO_RAD) * coneLength;
  const segments = circleSegments(rimRadius, "xy", -coneLength);
  for (let index = 0; index < CONE_RIB_COUNT; index++) {
    const angle = (index / CONE_RIB_COUNT) * Math.PI * 2;
    segments.push(segment(0, 0, 0, Math.cos(angle) * rimRadius, Math.sin(angle) * rimRadius, -coneLength));
  }
  return segments;
}

function channel(id, segments) {
  if (!segments.length) return null;
  return { id, color: GIZMO_CHANNEL_COLORS[id], segments };
}


export function buildSpotConeGizmo(request) {
  const source = request && typeof request === "object" ? request : {};
  const length = positiveNumber(source.range);
  return [
    channel(GIZMO_CHANNELS.OUTER_CONE, coneSegments(source.outerHalfAngleDeg, length)),
    channel(GIZMO_CHANNELS.INNER_CONE, coneSegments(source.innerHalfAngleDeg, length)),
  ].filter(Boolean);
}


export function buildSourceRadiusGizmo(request) {
  const source = request && typeof request === "object" ? request : {};
  const sourceRadius = positiveNumber(source.sourceRadius);
  const softRadius = sourceRadius + positiveNumber(source.softSourceRadius);
  const hardSegments = circleSegments(sourceRadius, "xy", 0).concat(circleSegments(sourceRadius, "xz", 0));
  const softSegments = softRadius > sourceRadius + MINIMUM_VISIBLE_SIZE ? circleSegments(softRadius, "xy", 0).concat(circleSegments(softRadius, "xz", 0)) : [];
  return [channel(GIZMO_CHANNELS.SOURCE_RADIUS, hardSegments), channel(GIZMO_CHANNELS.SOFT_SOURCE_RADIUS, softSegments)].filter(Boolean);
}


export function buildSourceCapsuleGizmo(request) {
  const source = request && typeof request === "object" ? request : {};
  const length = positiveNumber(source.sourceLength);
  if (length <= MINIMUM_VISIBLE_SIZE) return [];
  const radius = Math.max(positiveNumber(source.sourceRadius), 0.05);
  const halfLength = length / 2;
  const segments = circleSegments(radius, "xz", halfLength).concat(circleSegments(radius, "xz", -halfLength));
  segments.push(segment(radius, -halfLength, 0, radius, halfLength, 0));
  segments.push(segment(-radius, -halfLength, 0, -radius, halfLength, 0));
  segments.push(segment(0, -halfLength, radius, 0, halfLength, radius));
  segments.push(segment(0, -halfLength, -radius, 0, halfLength, -radius));
  segments.push(segment(0, halfLength + radius, 0, 0, halfLength, 0));
  segments.push(segment(0, -halfLength - radius, 0, 0, -halfLength, 0));
  return [channel(GIZMO_CHANNELS.SOURCE_CAPSULE, segments)].filter(Boolean);
}

function rectFrameSegments(halfWidth, halfHeight) {
  return [
    segment(-halfWidth, -halfHeight, 0, halfWidth, -halfHeight, 0),
    segment(halfWidth, -halfHeight, 0, halfWidth, halfHeight, 0),
    segment(halfWidth, halfHeight, 0, -halfWidth, halfHeight, 0),
    segment(-halfWidth, halfHeight, 0, -halfWidth, -halfHeight, 0),
  ];
}


function barnDoorSegments(halfWidth, halfHeight, angleDeg, doorLength) {
  const length = positiveNumber(doorLength);
  if (length <= MINIMUM_VISIBLE_SIZE) return [];
  const angle = Math.min(Math.max(Number(angleDeg), 0), 90) * DEG_TO_RAD;
  const outward = Math.sin(angle) * length;
  const forward = Math.cos(angle) * length;
  const edges = [
    { origin: [halfWidth, 0, 0], axis: [0, halfHeight, 0], normal: [1, 0, 0] },
    { origin: [-halfWidth, 0, 0], axis: [0, halfHeight, 0], normal: [-1, 0, 0] },
    { origin: [0, halfHeight, 0], axis: [halfWidth, 0, 0], normal: [0, 1, 0] },
    { origin: [0, -halfHeight, 0], axis: [halfWidth, 0, 0], normal: [0, -1, 0] },
  ];
  const segments = [];
  edges.forEach((edge) => {
    const tipX = edge.origin[0] + edge.normal[0] * outward;
    const tipY = edge.origin[1] + edge.normal[1] * outward;
    const tipZ = -forward;
    const firstCornerX = edge.origin[0] + edge.axis[0];
    const firstCornerY = edge.origin[1] + edge.axis[1];
    const secondCornerX = edge.origin[0] - edge.axis[0];
    const secondCornerY = edge.origin[1] - edge.axis[1];
    segments.push(segment(firstCornerX, firstCornerY, 0, tipX + edge.axis[0], tipY + edge.axis[1], tipZ));
    segments.push(segment(secondCornerX, secondCornerY, 0, tipX - edge.axis[0], tipY - edge.axis[1], tipZ));
    segments.push(segment(tipX + edge.axis[0], tipY + edge.axis[1], tipZ, tipX - edge.axis[0], tipY - edge.axis[1], tipZ));
  });
  return segments;
}


export function buildRectGizmo(request) {
  const source = request && typeof request === "object" ? request : {};
  const halfWidth = positiveNumber(source.width) / 2;
  const halfHeight = positiveNumber(source.height) / 2;
  if (halfWidth <= MINIMUM_VISIBLE_SIZE || halfHeight <= MINIMUM_VISIBLE_SIZE) return [];
  return [
    channel(GIZMO_CHANNELS.RECT_FRAME, rectFrameSegments(halfWidth, halfHeight)),
    channel(GIZMO_CHANNELS.BARN_DOORS, barnDoorSegments(halfWidth, halfHeight, source.barnDoorAngle, source.barnDoorLength)),
  ].filter(Boolean);
}

const RECT_GIZMO_KINDS = ["SurfaceLight", "RectLight"];
const CONE_GIZMO_KINDS = ["SpotLight", "SurfaceLight"];


export function buildLightGizmo(request) {
  const source = request && typeof request === "object" ? request : {};
  const props = source.props && typeof source.props === "object" ? source.props : {};
  const cone = source.cone && typeof source.cone === "object" ? source.cone : null;
  const kind = source.kind;
  let channels = buildSourceRadiusGizmo({ sourceRadius: props.SourceRadius, softSourceRadius: props.SoftSourceRadius }).concat(
    buildSourceCapsuleGizmo({ sourceRadius: props.SourceRadius, sourceLength: props.SourceLength }),
  );
  if (cone && CONE_GIZMO_KINDS.indexOf(kind) >= 0) {
    channels = channels.concat(
      buildSpotConeGizmo({ outerHalfAngleDeg: cone.outerHalfAngleDeg, innerHalfAngleDeg: cone.innerHalfAngleDeg, range: props.Range }),
    );
  }
  if (RECT_GIZMO_KINDS.indexOf(kind) >= 0) {
    channels = channels.concat(
      buildRectGizmo({
        width: props.Width,
        height: props.Height,
        barnDoorAngle: props.BarnDoorAngle,
        barnDoorLength: props.BarnDoorLength,
      }),
    );
  }
  return {
    kind: kind || null,
    channels,
    segmentCount: channels.reduce((total, item) => total + item.segments.length, 0),
    missingConeData: CONE_GIZMO_KINDS.indexOf(kind) >= 0 && !cone,
  };
}
