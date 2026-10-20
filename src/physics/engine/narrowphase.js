import { Vec3 } from "./math3d.js";
import { SHAPE } from "./shapes.js";

const FACE_EDGE_TOLERANCE = 1e-3;
const KEEP_DEPTH = -0.01;

function transformConvex(shape, pos, quat) {
  const verts = new Array(shape.vertices.length);
  for (let i = 0; i < shape.vertices.length; i++) {
    const w = quat.vmult(shape.vertices[i], new Vec3());
    w.x += pos.x;
    w.y += pos.y;
    w.z += pos.z;
    verts[i] = w;
  }
  const normals = shape.faceNormals.map((n) => quat.vmult(n, new Vec3()));
  const edges = shape.uniqueEdges.map((e) => quat.vmult(e, new Vec3()));
  const centroid = quat.vmult(shape.centroid, new Vec3());
  centroid.x += pos.x;
  centroid.y += pos.y;
  centroid.z += pos.z;
  return { shape, verts, normals, edges, centroid };
}

function separationAlong(hullA, hullB, axis) {
  let maxA = -Infinity;
  for (const v of hullA.verts) {
    const d = v.dot(axis);
    if (d > maxA) maxA = d;
  }
  let minB = Infinity;
  for (const v of hullB.verts) {
    const d = v.dot(axis);
    if (d < minB) minB = d;
  }
  return minB - maxA;
}

function findSeparatingAxis(hullA, hullB) {
  let best = { sep: -Infinity, axis: null, ref: null, faceIndex: -1 };
  for (let i = 0; i < hullA.normals.length; i++) {
    if (hullA.normals[i].lengthSquared() < 0.5) continue;
    const sep = separationAlong(hullA, hullB, hullA.normals[i]);
    if (sep > 0) return null;
    if (sep > best.sep) best = { sep, axis: hullA.normals[i], ref: "A", faceIndex: i };
  }
  for (let i = 0; i < hullB.normals.length; i++) {
    if (hullB.normals[i].lengthSquared() < 0.5) continue;
    const axis = hullB.normals[i].negate(new Vec3());
    const sep = separationAlong(hullA, hullB, axis);
    if (sep > 0) return null;
    if (sep > best.sep) best = { sep, axis, ref: "B", faceIndex: i };
  }
  let bestEdge = { sep: -Infinity, axis: null };
  const between = hullB.centroid.vsub(hullA.centroid);
  for (const ea of hullA.edges) {
    for (const eb of hullB.edges) {
      const axis = ea.cross(eb);
      if (axis.normalize() < 1e-6) continue;
      if (axis.dot(between) < 0) axis.negate(axis);
      const sep = separationAlong(hullA, hullB, axis);
      if (sep > 0) return null;
      if (sep > bestEdge.sep) bestEdge = { sep, axis: axis.clone() };
    }
  }
  if (bestEdge.axis && bestEdge.sep > best.sep + FACE_EDGE_TOLERANCE) {
    return { sep: bestEdge.sep, axis: bestEdge.axis, ref: "edge", faceIndex: -1 };
  }
  return best.axis ? best : null;
}

function clipPolygon(poly, planeNormal, planePoint) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = planeNormal.dot(a.vsub(planePoint));
    const db = planeNormal.dot(b.vsub(planePoint));
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push(new Vec3(
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
        a.z + (b.z - a.z) * t,
      ));
    }
  }
  return out;
}

function reduceManifold(contacts) {
  if (contacts.length <= 4) return contacts;
  contacts.sort((a, b) => b.depth - a.depth);
  const kept = [contacts[0]];
  let far = null;
  let farD = -1;
  for (const c of contacts) {
    const d = c.point.distanceSquared(kept[0].point);
    if (d > farD) {
      farD = d;
      far = c;
    }
  }
  if (far && far !== kept[0]) kept.push(far);
  while (kept.length < 4) {
    let cand = null;
    let score = -1;
    for (const c of contacts) {
      if (kept.indexOf(c) >= 0) continue;
      let s = 0;
      for (const k of kept) s += c.point.distanceSquared(k.point);
      if (s > score) {
        score = s;
        cand = c;
      }
    }
    if (!cand) break;
    kept.push(cand);
  }
  return kept;
}

function faceCenterOf(verts) {
  const c = new Vec3();
  for (const v of verts) {
    c.x += v.x;
    c.y += v.y;
    c.z += v.z;
  }
  return c.scale(1 / Math.max(1, verts.length), c);
}

function clipFaceContacts(refHull, incHull, refFaceIndex, flip) {
  const n = refHull.normals[refFaceIndex];
  const refVerts = refHull.shape.faces[refFaceIndex].map((i) => refHull.verts[i]);
  const planeD = n.dot(refVerts[0]);

  let incIndex = 0;
  let minDot = Infinity;
  for (let i = 0; i < incHull.normals.length; i++) {
    const dot = incHull.normals[i].dot(n);
    if (dot < minDot) {
      minDot = dot;
      incIndex = i;
    }
  }
  let poly = incHull.shape.faces[incIndex].map((i) => incHull.verts[i].clone());

  const faceCenter = faceCenterOf(refVerts);
  for (let i = 0; i < refVerts.length && poly.length > 0; i++) {
    const v1 = refVerts[i];
    const v2 = refVerts[(i + 1) % refVerts.length];
    const side = v2.vsub(v1).cross(n);
    if (side.normalize() < 1e-9) continue;
    if (side.dot(faceCenter.vsub(v1)) < 0) side.negate(side);
    poly = clipPolygon(poly, side, v1);
  }

  const contacts = [];
  for (const p of poly) {
    const depth = planeD - n.dot(p);
    if (depth > KEEP_DEPTH) {
      contacts.push({
        point: p,
        normal: flip ? n.negate(new Vec3()) : n.clone(),
        depth,
      });
    }
  }
  return contacts.length ? reduceManifold(contacts) : null;
}

function convexConvex(hullA, hullB) {
  const sat = findSeparatingAxis(hullA, hullB);
  if (!sat) return null;
  if (sat.ref === "B") return clipFaceContacts(hullB, hullA, sat.faceIndex, true);
  if (sat.ref === "A") return clipFaceContacts(hullA, hullB, sat.faceIndex, false);
  let idx = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < hullA.normals.length; i++) {
    const dot = hullA.normals[i].dot(sat.axis);
    if (dot > bestDot) {
      bestDot = dot;
      idx = i;
    }
  }
  return clipFaceContacts(hullA, hullB, idx, false);
}

function closestPointOnSegment(p, a, b) {
  const ab = b.vsub(a);
  const len2 = ab.lengthSquared();
  if (len2 < 1e-12) return a.clone();
  let t = p.vsub(a).dot(ab) / len2;
  t = Math.max(0, Math.min(1, t));
  return new Vec3(a.x + ab.x * t, a.y + ab.y * t, a.z + ab.z * t);
}

function sphereConvex(hull, center, radius) {
  let bestSep = -Infinity;
  let bestFace = -1;
  for (let i = 0; i < hull.normals.length; i++) {
    const n = hull.normals[i];
    if (n.lengthSquared() < 0.5) continue;
    const v0 = hull.verts[hull.shape.faces[i][0]];
    const sep = n.dot(center) - n.dot(v0);
    if (sep > radius) return null;
    if (sep > bestSep) {
      bestSep = sep;
      bestFace = i;
    }
  }
  if (bestFace < 0) return null;
  const n = hull.normals[bestFace];
  const faceVerts = hull.shape.faces[bestFace].map((i) => hull.verts[i]);

  if (bestSep < 0) {
    const point = center.vsub(n.scale(bestSep, new Vec3()));
    return [{ point, normal: n.clone(), depth: radius - bestSep }];
  }

  const q = center.vsub(n.scale(bestSep, new Vec3()));
  const faceCenter = faceCenterOf(faceVerts);
  let inside = true;
  for (let i = 0; i < faceVerts.length; i++) {
    const v1 = faceVerts[i];
    const v2 = faceVerts[(i + 1) % faceVerts.length];
    const side = v2.vsub(v1).cross(n);
    if (side.normalize() < 1e-9) continue;
    if (side.dot(faceCenter.vsub(v1)) < 0) side.negate(side);
    if (side.dot(q.vsub(v1)) < 0) {
      inside = false;
      break;
    }
  }
  if (inside) {
    return [{ point: q, normal: n.clone(), depth: radius - bestSep }];
  }

  let closest = null;
  let bestD2 = Infinity;
  for (let i = 0; i < faceVerts.length; i++) {
    const p = closestPointOnSegment(center, faceVerts[i], faceVerts[(i + 1) % faceVerts.length]);
    const d2 = p.distanceSquared(center);
    if (d2 < bestD2) {
      bestD2 = d2;
      closest = p;
    }
  }
  const dist = Math.sqrt(bestD2);
  if (!closest || dist > radius) return null;
  if (dist < 1e-9) {
    return [{ point: closest, normal: n.clone(), depth: radius }];
  }
  const normal = center.vsub(closest).scale(1 / dist, new Vec3());
  return [{ point: closest, normal, depth: radius - dist }];
}

function sphereSphere(posA, radiusA, posB, radiusB) {
  const d = posB.vsub(posA);
  const dist = d.length();
  const rsum = radiusA + radiusB;
  if (dist > rsum) return null;
  const n = dist > 1e-9 ? d.scale(1 / dist, new Vec3()) : new Vec3(0, 1, 0);
  const depth = rsum - dist;
  const point = posA.vadd(n.scale(radiusA - depth / 2, new Vec3()));
  return [{ point, normal: n, depth }];
}


const SDF_CONTACT_MARGIN = 0.03;

function sdfSampleSafe(sdf, x, y, z) {
  let s = null;
  try {
    s = sdf.sample ? sdf.sample(x, y, z) : null;
  } catch (_err) {
    s = null;                                                        
  }
  if (!s || !Number.isFinite(s.sd)) return null;
  if (!Number.isFinite(s.nx) || !Number.isFinite(s.ny) || !Number.isFinite(s.nz)) return null;


  const nl = Math.sqrt(s.nx * s.nx + s.ny * s.ny + s.nz * s.nz);
  if (!(nl > 1e-6)) return null;
  if (Math.abs(nl - 1) > 1e-3) {
    return { sd: s.sd, nx: s.nx / nl, ny: s.ny / nl, nz: s.nz / nl };
  }
  return s;
}

function sdfContactAt(sdf, x, y, z, contacts) {
  const s = sdfSampleSafe(sdf, x, y, z);
  if (!s || s.sd >= SDF_CONTACT_MARGIN) return;
  contacts.push({
    point: new Vec3(x, y, z),
    normal: new Vec3(s.nx, s.ny, s.nz),
    depth: Math.min(sdf.maxDepth, Math.max(0, -s.sd)),
  });
}

function sdfConvex(sdf, hull) {
  const contacts = [];
  const seen = new Set();
  const KEYQ = 1 / 0.05;
  const addPoint = (x, y, z) => {
    const key = Math.round(x * KEYQ) + "|" + Math.round(y * KEYQ) + "|" + Math.round(z * KEYQ);
    if (seen.has(key)) return;
    seen.add(key);
    sdfContactAt(sdf, x, y, z, contacts);
  };
  for (const v of hull.verts) addPoint(v.x, v.y, v.z);


  for (const face of hull.shape.faces) {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < face.length; i++) {
      const a = hull.verts[face[i]];
      const b = hull.verts[face[(i + 1) % face.length]];
      addPoint((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      cx += a.x; cy += a.y; cz += a.z;
    }
    if (face.length > 0) addPoint(cx / face.length, cy / face.length, cz / face.length);
  }
  return contacts.length ? reduceManifold(contacts) : null;
}

function sdfSphere(sdf, center, radius) {
  const s = sdfSampleSafe(sdf, center.x, center.y, center.z);
  if (!s || s.sd >= radius + SDF_CONTACT_MARGIN) return null;

  const point = new Vec3(
    center.x - s.nx * s.sd,
    center.y - s.ny * s.sd,
    center.z - s.nz * s.sd,
  );
  return [{
    point,
    normal: new Vec3(s.nx, s.ny, s.nz),
    depth: Math.min(sdf.maxDepth + radius, Math.max(0, radius - s.sd)),
  }];
}

export function collideShapes(shapeA, posA, quatA, shapeB, posB, quatB) {
  const aSdf = shapeA.type === SHAPE.SDF;
  const bSdf = shapeB.type === SHAPE.SDF;
  if (aSdf || bSdf) {
    if (aSdf && bSdf) return null;                                    
    const sdf = aSdf ? shapeA : shapeB;
    const other = aSdf ? shapeB : shapeA;
    const posO = aSdf ? posB : posA;
    const quatO = aSdf ? quatB : quatA;
    let res = null;
    if (other.type === SHAPE.SPHERE) res = sdfSphere(sdf, posO, other.radius);
    else if (other.type === SHAPE.CONVEX) res = sdfConvex(sdf, transformConvex(other, posO, quatO));
    if (!res || !res.length) return null;


    if (bSdf) for (const c of res) c.normal.negate(c.normal);
    return res;
  }
  const aSphere = shapeA.type === SHAPE.SPHERE;
  const bSphere = shapeB.type === SHAPE.SPHERE;
  if (aSphere && bSphere) {
    return sphereSphere(posA, shapeA.radius, posB, shapeB.radius);
  }
  if (!aSphere && !bSphere) {
    return convexConvex(transformConvex(shapeA, posA, quatA), transformConvex(shapeB, posB, quatB));
  }
  if (!aSphere && bSphere) {
    return sphereConvex(transformConvex(shapeA, posA, quatA), posB, shapeB.radius);
  }
  const res = sphereConvex(transformConvex(shapeB, posB, quatB), posA, shapeA.radius);
  if (!res) return null;
  for (const c of res) c.normal.negate(c.normal);
  return res;
}
