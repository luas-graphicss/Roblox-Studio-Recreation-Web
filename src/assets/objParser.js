export const MAX_TRIANGLES = 50000;

function num(s) {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}


function resolveIndex(raw, count) {
  const i = parseInt(raw, 10);
  if (!Number.isFinite(i) || i === 0) return -1;
  const idx = i > 0 ? i - 1 : count + i;
  return idx >= 0 && idx < count ? idx : -1;
}


export function parseObj(text, opts = {}) {
  const maxTriangles = Number.isFinite(opts.maxTriangles) ? opts.maxTriangles : MAX_TRIANGLES;
  const warnings = [];
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, error: "Arquivo .obj vazio ou inválido.", warnings };
  }

  const verts = [];               
  const norms = [];
  const uvs = [];
  const faces = [];                                            
  let badLines = 0;

  const lines = text.split(/\r\n|\r|\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line || line[0] === "#") continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];
    try {
      if (tag === "v") {
        if (parts.length < 4) { badLines++; continue; }
        verts.push(num(parts[1]), num(parts[2]), num(parts[3]));
      } else if (tag === "vn") {
        if (parts.length < 4) { badLines++; continue; }
        norms.push(num(parts[1]), num(parts[2]), num(parts[3]));
      } else if (tag === "vt") {


        if (parts.length < 2) { badLines++; continue; }
        uvs.push(num(parts[1]), num(parts[2]));
      } else if (tag === "f") {
        if (parts.length < 4) { badLines++; continue; }
        const face = [];
        for (let i = 1; i < parts.length; i++) {
          const ref = parts[i].split("/");
          const v = resolveIndex(ref[0], verts.length / 3);
          if (v < 0) { face.length = 0; break; }
          const vt = ref.length > 1 && ref[1] !== "" ? resolveIndex(ref[1], uvs.length / 2) : -1;
          const vn = ref.length > 2 && ref[2] !== "" ? resolveIndex(ref[2], norms.length / 3) : -1;
          face.push({ v, vt, vn });
        }
        if (face.length >= 3) faces.push(face);
        else badLines++;
      }

    } catch (_) {
      badLines++;
    }
  }

  if (badLines > 0) warnings.push(`${badLines} linha(s) malformada(s) ignorada(s).`);
  if (faces.length === 0 || verts.length === 0) {
    return { ok: false, error: "O arquivo .obj não contém faces válidas.", warnings };
  }


  let triangleCount = 0;
  for (const f of faces) triangleCount += f.length - 2;
  if (triangleCount > maxTriangles) {
    return {
      ok: false,
      error: `Mesh com ${triangleCount.toLocaleString("pt-BR")} triângulos excede o limite de ${maxTriangles.toLocaleString("pt-BR")}.`,
      triangleCount,
      warnings,
    };
  }

  const positions = new Float32Array(triangleCount * 9);
  const normals = new Float32Array(triangleCount * 9);
  const uvOut = new Float32Array(triangleCount * 6);
  let hasAnyNormal = false;
  let p = 0, n = 0, t = 0;

  const writeVert = (ref) => {
    const vi = ref.v * 3;
    positions[p++] = verts[vi];
    positions[p++] = verts[vi + 1];
    positions[p++] = verts[vi + 2];
    if (ref.vn >= 0) {
      const ni = ref.vn * 3;
      normals[n++] = norms[ni];
      normals[n++] = norms[ni + 1];
      normals[n++] = norms[ni + 2];
      hasAnyNormal = true;
    } else {
      n += 3;                                            
    }
    if (ref.vt >= 0) {
      const ti = ref.vt * 2;
      uvOut[t++] = uvs[ti];
      uvOut[t++] = uvs[ti + 1];
    } else {
      t += 2;
    }
  };

  for (const f of faces) {
    for (let i = 1; i < f.length - 1; i++) {
      writeVert(f[0]);
      writeVert(f[i]);
      writeVert(f[i + 1]);
    }
  }

  if (!hasAnyNormal) computeFlatNormals(positions, normals);
  else fillMissingNormals(positions, normals);


  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const size = {
    x: Math.max(0.001, maxX - minX),
    y: Math.max(0.001, maxY - minY),
    z: Math.max(0.001, maxZ - minZ),
  };

  return {
    ok: true,
    positions,
    normals,
    uvs: uvOut,
    triangleCount,
    warnings,
    bounds: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
    size,
  };
}


function computeFlatNormals(positions, normals) {
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      nx /= len; ny /= len; nz /= len;
    } else {

      nx = 0; ny = 1; nz = 0;
    }
    for (let k = 0; k < 3; k++) {
      normals[i + k * 3] = nx;
      normals[i + k * 3 + 1] = ny;
      normals[i + k * 3 + 2] = nz;
    }
  }
}


function fillMissingNormals(positions, normals) {
  const face = new Float32Array(9);
  for (let i = 0; i < normals.length; i += 9) {
    let needs = false;
    for (let k = 0; k < 3; k++) {
      const o = i + k * 3;
      if (normals[o] === 0 && normals[o + 1] === 0 && normals[o + 2] === 0) { needs = true; break; }
    }
    if (!needs) continue;
    computeFlatNormals(positions.subarray(i, i + 9), face);
    for (let k = 0; k < 3; k++) {
      const o = i + k * 3;
      if (normals[o] === 0 && normals[o + 1] === 0 && normals[o + 2] === 0) {
        normals[o] = face[0];
        normals[o + 1] = face[1];
        normals[o + 2] = face[2];
      }
    }
  }
}


export async function parseObjAsync(text, opts = {}, onProgress) {
  const big = typeof text === "string" && text.length > 512 * 1024;
  if (!big) {
    if (onProgress) onProgress(1);
    return parseObj(text, opts);
  }


  if (onProgress) onProgress(0.1);
  await new Promise((r) => setTimeout(r, 0));
  const res = parseObj(text, opts);
  if (onProgress) onProgress(1);
  return res;
}


export function countObjTriangles(text) {
  if (typeof text !== "string") return 0;
  let count = 0;
  const lines = text.split(/\r\n|\r|\n/);
  for (const raw of lines) {
    const line = raw.trim();


    if (line[0] !== "f" || !/\s/.test(line[1] || "")) continue;
    const refs = line.split(/\s+/).length - 1;
    if (refs >= 3) count += refs - 2;
  }
  return count;
}


export function renderObjThumbnail(parsed, sizePx = 96, doc) {
  const d = doc || (typeof document !== "undefined" ? document : null);
  if (!d || !parsed || !parsed.ok) return null;
  const canvas = d.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;


  const grad = ctx.createLinearGradient(0, 0, sizePx, sizePx);
  grad.addColorStop(0, "#3c4452");
  grad.addColorStop(1, "#23272f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sizePx, sizePx);

  const pos = parsed.positions;
  const nor = parsed.normals;
  const b = parsed.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cy = (b.min.y + b.max.y) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const maxDim = Math.max(parsed.size.x, parsed.size.y, parsed.size.z) || 1;
  const s = (sizePx * 0.72) / maxDim;


  const ry = Math.PI / 5, rx = Math.PI / 7;
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const lightDir = { x: 0.5, y: 0.8, z: 0.6 };
  const ll = Math.sqrt(lightDir.x ** 2 + lightDir.y ** 2 + lightDir.z ** 2);
  lightDir.x /= ll; lightDir.y /= ll; lightDir.z /= ll;

  const project = (x, y, z) => {
    x -= cx; y -= cy; z -= cz;
    let px = x * cosY + z * sinY;
    let pz = -x * sinY + z * cosY;
    let py = y * cosX - pz * sinX;
    pz = y * sinX + pz * cosX;
    return { x: sizePx / 2 + px * s, y: sizePx / 2 - py * s, z: pz };
  };


  const triCount = Math.floor(pos.length / 9);
  const step = Math.max(1, Math.ceil(triCount / 4000));
  const tris = [];
  for (let i = 0; i < triCount; i += step) {
    const o = i * 9;
    const a = project(pos[o], pos[o + 1], pos[o + 2]);
    const bb = project(pos[o + 3], pos[o + 4], pos[o + 5]);
    const c = project(pos[o + 6], pos[o + 7], pos[o + 8]);

    const ndl = Math.max(0.15, nor[o] * lightDir.x + nor[o + 1] * lightDir.y + nor[o + 2] * lightDir.z);
    tris.push({ a, b: bb, c, depth: (a.z + bb.z + c.z) / 3, shade: ndl });
  }
  tris.sort((t1, t2) => t1.depth - t2.depth);

  for (const t of tris) {
    const v = Math.floor(120 + t.shade * 130);
    ctx.fillStyle = `rgb(${Math.floor(v * 0.95)},${Math.floor(v * 0.78)},${Math.floor(v * 0.35)})`;
    ctx.beginPath();
    ctx.moveTo(t.a.x, t.a.y);
    ctx.lineTo(t.b.x, t.b.y);
    ctx.lineTo(t.c.x, t.c.y);
    ctx.closePath();
    ctx.fill();
  }
  try {
    return canvas.toDataURL("image/png");
  } catch (_) {
    return null;
  }
}


export function buildPrimitiveObj(kind) {
  switch (kind) {
    case "pyramid":
      return [
        "# RSW primitive: pyramid",
        "v -0.5 0 -0.5", "v 0.5 0 -0.5", "v 0.5 0 0.5", "v -0.5 0 0.5", "v 0 1 0",


        "f 1 5 2", "f 2 5 3", "f 3 5 4", "f 4 5 1", "f 1 2 3 4",
      ].join("\n");
    case "gem": {

      const lines = ["# RSW primitive: gem"];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        lines.push(`v ${(Math.cos(a) * 0.5).toFixed(4)} 0 ${(Math.sin(a) * 0.5).toFixed(4)}`);
      }
      lines.push("v 0 0.9 0", "v 0 -0.9 0");
      for (let i = 0; i < 6; i++) {
        const a2 = ((i + 1) % 6) + 1;


        lines.push(`f ${a2} ${i + 1} 7`);
        lines.push(`f ${i + 1} ${a2} 8`);
      }
      return lines.join("\n");
    }
    case "torus": {
      const lines = ["# RSW primitive: torus"];
      const SEG = 16, RING = 10, R = 0.36, r = 0.14;
      for (let i = 0; i < SEG; i++) {
        const u = (i / SEG) * Math.PI * 2;
        for (let j = 0; j < RING; j++) {
          const v = (j / RING) * Math.PI * 2;
          const x = (R + r * Math.cos(v)) * Math.cos(u);
          const y = r * Math.sin(v);
          const z = (R + r * Math.cos(v)) * Math.sin(u);
          lines.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
        }
      }
      for (let i = 0; i < SEG; i++) {
        for (let j = 0; j < RING; j++) {
          const a = i * RING + j + 1;
          const b = i * RING + ((j + 1) % RING) + 1;
          const c = ((i + 1) % SEG) * RING + ((j + 1) % RING) + 1;
          const d2 = ((i + 1) % SEG) * RING + j + 1;
          lines.push(`f ${a} ${b} ${c} ${d2}`);
        }
      }
      return lines.join("\n");
    }
    case "rock":
    default: {

      const lines = ["# RSW primitive: rock"];
      const tPhi = (1 + Math.sqrt(5)) / 2;
      const base = [
        [-1, tPhi, 0], [1, tPhi, 0], [-1, -tPhi, 0], [1, -tPhi, 0],
        [0, -1, tPhi], [0, 1, tPhi], [0, -1, -tPhi], [0, 1, -tPhi],
        [tPhi, 0, -1], [tPhi, 0, 1], [-tPhi, 0, -1], [-tPhi, 0, 1],
      ];
      let seed = 1337;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 0.3 + 0.85; };
      for (const [x, y, z] of base) {
        const k = (0.5 / tPhi) * rnd();
        lines.push(`v ${(x * k).toFixed(4)} ${(y * k).toFixed(4)} ${(z * k).toFixed(4)}`);
      }
      const F = [
        [1, 12, 6], [1, 6, 2], [1, 2, 8], [1, 8, 11], [1, 11, 12],
        [2, 6, 10], [6, 12, 5], [12, 11, 3], [11, 8, 7], [8, 2, 9],
        [4, 10, 5], [4, 5, 3], [4, 3, 7], [4, 7, 9], [4, 9, 10],
        [5, 10, 6], [3, 5, 12], [7, 3, 11], [9, 7, 8], [10, 9, 2],
      ];
      for (const f of F) lines.push(`f ${f[0]} ${f[1]} ${f[2]}`);
      return lines.join("\n");
    }
  }
}
