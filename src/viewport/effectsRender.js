import { getCachedWind } from "../climate/climateRuntime.js";            


import { particleEmissionBoost } from "../lighting/emissiveNitsCore.js";
import { getEmissiveRenderStyle } from "./baseMaterials.js";
import * as THREE from "three";
import { bus } from "../core/eventBus.js";

import { registerFrameCallback } from "../core/frameDriver.js";
import { store } from "../core/state.js";
import { Events } from "../datamodel/index.js";
import { engine } from "../runtime/engine.js";
import { logger } from "../core/logger.js";


const DEG2RAD = Math.PI / 180;
const MAX_ACTIVE_EMITTERS = 200;                                           
const MAX_PARTICLES = 500;                                               
const MAX_RATE = 1000;                               
const LIGHT_RESAMPLE_BUDGET = 64;                                                               
const LIGHT_SPAWN_MAX_SAMPLES = 128;                                                              
const LOD_NEAR = 80;                                                 
const LOD_FAR = 220;                                        
const TRAIL_MAX_RECORDS = 240;                                           


function clampN(v, lo, hi, fb) {
	const n = typeof v === "number" ? v : Number(v);
	if (!Number.isFinite(n)) return fb;
	return n < lo ? lo : n > hi ? hi : n;
}

function numOr(v, fb) {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : fb;
}


function isBasePart(inst) {
	return !!(
		inst &&
		typeof inst.hasProperty === "function" &&
		inst.hasProperty("Anchored") &&
		inst.hasProperty("Position") &&
		(typeof inst.isDestroyed !== "function" || !inst.isDestroyed())
	);
}

const TMP_EULER = new THREE.Euler();

function quatFromRotationDeg(rot) {
	const q = new THREE.Quaternion();
	TMP_EULER.set(
		numOr(rot && rot.x, 0) * DEG2RAD,
		numOr(rot && rot.y, 0) * DEG2RAD,
		numOr(rot && rot.z, 0) * DEG2RAD,


		"XYZ",
	);
	q.setFromEuler(TMP_EULER);
	return q;
}


function partPose(part) {
	let pos = null;
	let rot = null;
	try {
		pos = part.getProperty("Position");
		rot = part.getProperty("Rotation");
	} catch {

	}
	return {
		pos: new THREE.Vector3(
			numOr(pos && pos.x, 0),
			numOr(pos && pos.y, 0),
			numOr(pos && pos.z, 0),
		),
		quat: quatFromRotationDeg(rot),
	};
}

function partSize(part) {
	let s = null;
	try {
		s = part.getProperty("Size");
	} catch {

	}
	return {
		x: Math.max(0.05, Math.abs(numOr(s && s.x, 4))),
		y: Math.max(0.05, Math.abs(numOr(s && s.y, 1))),
		z: Math.max(0.05, Math.abs(numOr(s && s.z, 2))),
	};
}


function attachmentWorld(att) {
	if (!att || (typeof att.isDestroyed === "function" && att.isDestroyed())) {
		return null;
	}
	let lp = null;
	let lo = null;
	try {
		lp = att.getProperty("Position");
		lo = att.getProperty("Orientation");
	} catch {
		return null;
	}
	const parent = typeof att.getParent === "function" ? att.getParent() : null;
	if (!isBasePart(parent)) return null;
	const localPos = new THREE.Vector3(
		numOr(lp && lp.x, 0),
		numOr(lp && lp.y, 0),
		numOr(lp && lp.z, 0),
	);
	const localQuat = quatFromRotationDeg(lo);
	const pp = partPose(parent);
	const pos = localPos.applyQuaternion(pp.quat).add(pp.pos);
	const quat = pp.quat.clone().multiply(localQuat);
	return { pos, quat };
}


const FACE_NORMALS = Object.freeze({
	Top: new THREE.Vector3(0, 1, 0),
	Bottom: new THREE.Vector3(0, -1, 0),
	Front: new THREE.Vector3(0, 0, -1),
	Back: new THREE.Vector3(0, 0, 1),
	Left: new THREE.Vector3(-1, 0, 0),
	Right: new THREE.Vector3(1, 0, 0),
});


function evalNumberSeq(seq, t, jit) {
	const kps = seq && Array.isArray(seq.keypoints) ? seq.keypoints : null;
	if (!kps || kps.length === 0) return 0;
	const tc = numOr(t, 0);
	const tt = tc < 0 ? 0 : tc > 1 ? 1 : tc;
	let a = kps[0];
	let b = kps[kps.length - 1];
	for (let i = 0; i < kps.length - 1; i++) {
		if (tt >= numOr(kps[i].time, 0) && tt <= numOr(kps[i + 1].time, 1)) {
			a = kps[i];
			b = kps[i + 1];
			break;
		}
	}
	const ta = numOr(a.time, 0);
	const tb = numOr(b.time, 1);
	const f = tb > ta ? (tt - ta) / (tb - ta) : 0;
	let v = numOr(a.value, 0) + (numOr(b.value, 0) - numOr(a.value, 0)) * f;
	if (jit !== undefined && jit !== null) {
		const env =
			numOr(a.envelope, 0) + (numOr(b.envelope, 0) - numOr(a.envelope, 0)) * f;
		v += env * (numOr(jit, 0.5) * 2 - 1);
	}
	return v;
}


function evalColorSeq(seq, t, out) {
	const kps = seq && Array.isArray(seq.keypoints) ? seq.keypoints : null;
	if (!kps || kps.length === 0) {
		out.r = 1;
		out.g = 1;
		out.b = 1;
		return out;
	}
	const tc = numOr(t, 0);
	const tt = tc < 0 ? 0 : tc > 1 ? 1 : tc;
	let a = kps[0];
	let b = kps[kps.length - 1];
	for (let i = 0; i < kps.length - 1; i++) {
		if (tt >= numOr(kps[i].time, 0) && tt <= numOr(kps[i + 1].time, 1)) {
			a = kps[i];
			b = kps[i + 1];
			break;
		}
	}
	const ta = numOr(a.time, 0);
	const tb = numOr(b.time, 1);
	const f = tb > ta ? (tt - ta) / (tb - ta) : 0;
	const ca = a.color || {};
	const cb = b.color || {};
	out.r = numOr(ca.r, 1) + (numOr(cb.r, 1) - numOr(ca.r, 1)) * f;
	out.g = numOr(ca.g, 1) + (numOr(cb.g, 1) - numOr(ca.g, 1)) * f;
	out.b = numOr(ca.b, 1) + (numOr(cb.b, 1) - numOr(ca.b, 1)) * f;
	return out;
}


const textureCache = new Map();

function hashString(s) {
	const str = String(s == null ? "" : s);
	let h = 2166136261 >>> 0;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

function makeCanvas(size) {
	const c = document.createElement("canvas");
	c.width = size;
	c.height = size;
	return c;
}


function getEffectTexture(kind, asset) {
	const key = kind === "asset" ? "asset:" + hashString(asset) : String(kind);
	const hit = textureCache.get(key);
	if (hit) return hit;
	const size = 64;
	const cv = makeCanvas(size);
	const g = cv.getContext("2d");
	g.clearRect(0, 0, size, size);
	if (kind === "flame") {
		const grad = g.createRadialGradient(32, 38, 2, 32, 34, 28);
		grad.addColorStop(0, "rgba(255,255,255,1)");
		grad.addColorStop(0.4, "rgba(255,255,255,0.8)");
		grad.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = grad;
		g.beginPath();
		g.ellipse(32, 34, 15, 26, 0, 0, Math.PI * 2);
		g.fill();
	} else if (kind === "smoke") {
		for (let i = 0; i < 8; i++) {
			const x = 18 + ((i * 37) % 28);
			const y = 20 + ((i * 53) % 24);
			const r = 10 + (i % 3) * 5;
			const grad = g.createRadialGradient(x, y, 1, x, y, r);
			grad.addColorStop(0, "rgba(255,255,255,0.45)");
			grad.addColorStop(1, "rgba(255,255,255,0)");
			g.fillStyle = grad;
			g.beginPath();
			g.arc(x, y, r, 0, Math.PI * 2);
			g.fill();
		}
	} else if (kind === "spark") {
		const grad = g.createRadialGradient(32, 32, 1, 32, 32, 10);
		grad.addColorStop(0, "rgba(255,255,255,1)");
		grad.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = grad;
		g.beginPath();
		g.arc(32, 32, 10, 0, Math.PI * 2);
		g.fill();
		g.strokeStyle = "rgba(255,255,255,0.9)";
		g.lineWidth = 2;
		g.beginPath();
		g.moveTo(32, 4);
		g.lineTo(32, 60);
		g.moveTo(4, 32);
		g.lineTo(60, 32);
		g.stroke();
		g.strokeStyle = "rgba(255,255,255,0.35)";
		g.beginPath();
		g.moveTo(12, 12);
		g.lineTo(52, 52);
		g.moveTo(52, 12);
		g.lineTo(12, 52);
		g.stroke();
	} else if (kind === "asset") {
		const h = hashString(asset);
		const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
		grad.addColorStop(0, "rgba(255,255,255,1)");
		grad.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = grad;
		g.beginPath();
		g.arc(32, 32, 30, 0, Math.PI * 2);
		g.fill();

		g.globalCompositeOperation = "destination-out";
		const rings = 1 + (h % 3);
		for (let i = 0; i < rings; i++) {
			const rr = 8 + ((h >> (i * 5)) % 18);
			g.strokeStyle = "rgba(0,0,0,0.5)";
			g.lineWidth = 1.5;
			g.beginPath();
			g.arc(32, 32, rr, 0, Math.PI * 2);
			g.stroke();
		}
		g.globalCompositeOperation = "source-over";
	} else {

		const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
		grad.addColorStop(0, "rgba(255,255,255,1)");
		grad.addColorStop(0.5, "rgba(255,255,255,0.6)");
		grad.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = grad;
		g.beginPath();
		g.arc(32, 32, 30, 0, Math.PI * 2);
		g.fill();
	}
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	textureCache.set(key, tex);
	return tex;
}


const PARTICLE_VERT = `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
attribute float aRot;
attribute float aFrame;
attribute float aSquash;
attribute vec3 aLight;
varying vec4 vCol;
varying float vRot;
varying float vFrame;
varying float vSquash;
varying vec3 vLight;
uniform float uPixelScale;
void main() {
  vCol = vec4(aColor, aAlpha);
  vRot = aRot;
  vFrame = aFrame;
  vSquash = aSquash;
  vLight = aLight;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(0.1, -mv.z);
  gl_PointSize = clamp(aSize * uPixelScale / dist, 0.0, 512.0);
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = `
uniform sampler2D uMap;
uniform float uCells;
uniform float uLightInfluence;
uniform float uEmissiveBoost;
varying vec4 vCol;
varying float vRot;
varying float vFrame;
varying float vSquash;
                                                                              
                                                                        
                                          
varying vec3 vLight;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(vRot);
  float s = sin(vRot);
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  float sq = 1.0 + max(0.0, vSquash);
  uv = vec2(uv.x / sq, uv.y * sq) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  if (uCells > 1.0) {
    float f = floor(vFrame);
    float col = mod(f, uCells);
    float row = mod(floor(f / uCells), uCells);
    uv = (uv + vec2(col, uCells - 1.0 - row)) / uCells;
  }
  vec4 tex = texture2D(uMap, uv);
  gl_FragColor = tex * vCol;
                                                                         
                                                                          
                                                                       
  gl_FragColor.rgb *= mix(vec3(1.0), vLight, uLightInfluence);
                                                                        
  gl_FragColor.rgb *= uEmissiveBoost;
  if (gl_FragColor.a < 0.012) discard;
}
`;

const FLIPBOOK_CELLS = { None: 1, Grid2x2: 2, Grid4x4: 4, Grid8x8: 8 };


const TMP_PLIGHT = { r: 1, g: 1, b: 1 };

class ParticlePool {
  constructor(group, capacity, texture, additive) {
    this.cap = Math.max(8, Math.min(MAX_PARTICLES, capacity | 0));
    this.alive = 0;
    const cap = this.cap;

    this.px = new Float32Array(cap); this.py = new Float32Array(cap); this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap); this.vz = new Float32Array(cap);
    this.age = new Float32Array(cap); this.life = new Float32Array(cap);
    this.rot = new Float32Array(cap); this.rotV = new Float32Array(cap);
    this.seed = new Float32Array(cap);

    this.lr = new Float32Array(cap).fill(1);
    this.lg = new Float32Array(cap).fill(1);
    this.lb = new Float32Array(cap).fill(1);
    this.lightCursor = 0;                                                    

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aRot", new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aFrame", new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aSquash", new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("aLight", new THREE.BufferAttribute(new Float32Array(cap * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uCells: { value: 1 },
        uPixelScale: { value: 600 },
        uLightInfluence: { value: 0 },
        uEmissiveBoost: { value: 1 },                                  
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.geo = geo;
    this.mat = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;                                     
    group.add(this.points);
    this.group = group;

    console.assert(
      this.lr.length === this.cap && geo.attributes.aLight.array.length === this.cap * 3,
      "ParticlePool: buffers de luz dessincronizados da capacidade",
    );
  }

  setTexture(tex) {
    if (this.mat.uniforms.uMap.value !== tex) this.mat.uniforms.uMap.value = tex;
  }

  setBlending(additive) {
    const b = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (this.mat.blending !== b) { this.mat.blending = b; this.mat.needsUpdate = true; }
  }


  setLightInfluence(f) {
    this.mat.uniforms.uLightInfluence.value = f;
  }


  setEmissiveBoost(b) {
    if (this.mat.uniforms.uEmissiveBoost.value !== b) this.mat.uniforms.uEmissiveBoost.value = b;
  }


  sampleLights(sampleLight, budget) {
    const n = this.alive;
    if (n <= 0) return;
    let cursor = this.lightCursor >= n ? 0 : this.lightCursor;
    const count = Math.min(n, budget);
    for (let k = 0; k < count; k++) {
      sampleLight(this.px[cursor], this.py[cursor], this.pz[cursor], TMP_PLIGHT);
      this.lr[cursor] = TMP_PLIGHT.r;
      this.lg[cursor] = TMP_PLIGHT.g;
      this.lb[cursor] = TMP_PLIGHT.b;
      cursor = cursor + 1 >= n ? 0 : cursor + 1;
    }
    this.lightCursor = cursor;
  }

  kill(i) {
    const last = this.alive - 1;
    if (i !== last) {
      this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
      this.age[i] = this.age[last]; this.life[i] = this.life[last];
      this.rot[i] = this.rot[last]; this.rotV[i] = this.rotV[last];
      this.seed[i] = this.seed[last];
      this.lr[i] = this.lr[last]; this.lg[i] = this.lg[last]; this.lb[i] = this.lb[last];
    }
    this.alive = last;
  }


  spawn(n, cfg, pose, size3, parentVel, sampleLight) {
    const sampleStride = sampleLight && n > LIGHT_SPAWN_MAX_SAMPLES ? Math.ceil(n / LIGHT_SPAWN_MAX_SAMPLES) : 1;
    let spawned = 0;
    const face = FACE_NORMALS[cfg.emissionDirection] || FACE_NORMALS.Top;

    const normal = face;
    const tangent = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0).cross(normal).normalize();
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent);
    const tmpDir = new THREE.Vector3();
    const tmpOff = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      if (this.alive >= this.cap) break;
      const i = this.alive++;

      const surface = cfg.shapeStyle === "Surface";
      if (cfg.shape === "Sphere") {
        const r = Math.min(size3.x, Math.min(size3.y, size3.z)) * 0.5;
        tmpDir.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 1, 0);
        tmpDir.normalize();
        const rr = surface ? r : r * Math.cbrt(Math.random());
        tmpOff.copy(tmpDir).multiplyScalar(rr);
      } else if (cfg.shape === "Cylinder") {
        const r = Math.min(size3.x, size3.z) * 0.5;
        const ang = Math.random() * Math.PI * 2;
        const rr = surface ? r : r * Math.sqrt(Math.random());
        tmpOff.set(Math.cos(ang) * rr, (Math.random() - 0.5) * size3.y, Math.sin(ang) * rr);
      } else if (cfg.shape === "Disc") {
        const r = Math.min(size3.x, size3.z) * 0.5;
        const ang = Math.random() * Math.PI * 2;
        const rr = surface ? r : r * Math.sqrt(Math.random());
        tmpOff.set(Math.cos(ang) * rr, 0, Math.sin(ang) * rr);
      } else {

        tmpOff.set((Math.random() - 0.5) * size3.x, (Math.random() - 0.5) * size3.y, (Math.random() - 0.5) * size3.z);
        if (surface) {

          if (Math.abs(normal.x) > 0.5) tmpOff.x = Math.sign(normal.x) * size3.x * 0.5;
          else if (Math.abs(normal.y) > 0.5) tmpOff.y = Math.sign(normal.y) * size3.y * 0.5;
          else tmpOff.z = Math.sign(normal.z) * size3.z * 0.5;
        }
      }
      tmpOff.applyQuaternion(pose.quat).add(pose.pos);
      this.px[i] = tmpOff.x; this.py[i] = tmpOff.y; this.pz[i] = tmpOff.z;

      const ax = (Math.random() - 0.5) * cfg.spreadX * DEG2RAD;
      const ay = (Math.random() - 0.5) * cfg.spreadY * DEG2RAD;
      tmpDir.copy(normal)
        .applyAxisAngle(tangent, ax)
        .applyAxisAngle(bitangent, ay)
        .applyQuaternion(pose.quat);
      const speed = cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin);
      this.vx[i] = tmpDir.x * speed + parentVel.x * cfg.velInherit;
      this.vy[i] = tmpDir.y * speed + parentVel.y * cfg.velInherit;
      this.vz[i] = tmpDir.z * speed + parentVel.z * cfg.velInherit;

      this.age[i] = 0;
      this.life[i] = Math.max(0.05, cfg.lifeMin + Math.random() * (cfg.lifeMax - cfg.lifeMin));
      this.rot[i] = (cfg.rotMin + Math.random() * (cfg.rotMax - cfg.rotMin)) * DEG2RAD;
      this.rotV[i] = (cfg.rotSpeedMin + Math.random() * (cfg.rotSpeedMax - cfg.rotSpeedMin)) * DEG2RAD;
      this.seed[i] = Math.random();

      if (sampleLight) {
        if (spawned % sampleStride === 0) {
          sampleLight(this.px[i], this.py[i], this.pz[i], TMP_PLIGHT);
        }
        this.lr[i] = TMP_PLIGHT.r; this.lg[i] = TMP_PLIGHT.g; this.lb[i] = TMP_PLIGHT.b;
      } else {
        this.lr[i] = 1; this.lg[i] = 1; this.lb[i] = 1;
      }
      spawned++;
    }
  }


  update(dt, cfg, ctx, lockedDX, lockedDY, lockedDZ) {
    const dragF = Math.max(0, 1 - clampN(cfg.drag, 0, 100, 0) * dt * 0.15);
    const rswWind = getCachedWind();
    const windX = cfg.windAffectsDrag ? (rswWind.x * 0.35 + Math.sin(ctx.time * 0.7) * 0.5) * dt : 0;
    const windZ = cfg.windAffectsDrag ? (rswWind.z * 0.35 + Math.cos(ctx.time * 0.53) * 0.4) * dt : 0;
    let i = 0;
    while (i < this.alive) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
      this.vx[i] = (this.vx[i] + cfg.accelX * dt) * dragF + windX;
      this.vy[i] = (this.vy[i] + cfg.accelY * dt) * dragF;
      this.vz[i] = (this.vz[i] + cfg.accelZ * dt) * dragF + windZ;
      this.px[i] += this.vx[i] * dt + lockedDX;
      this.py[i] += this.vy[i] * dt + lockedDY;
      this.pz[i] += this.vz[i] * dt + lockedDZ;
      this.rot[i] += this.rotV[i] * dt;
      i++;
    }

    const posA = this.geo.attributes.position.array;
    const colA = this.geo.attributes.aColor.array;
    const alpA = this.geo.attributes.aAlpha.array;
    const sizA = this.geo.attributes.aSize.array;
    const rotA = this.geo.attributes.aRot.array;
    const frmA = this.geo.attributes.aFrame.array;
    const sqA = this.geo.attributes.aSquash.array;
    const ligA = this.geo.attributes.aLight.array;
    const cells = FLIPBOOK_CELLS[cfg.flipbookLayout] || 1;
    const colTmp = { r: 1, g: 1, b: 1 };
    const camF = ctx.camForward;
    const camR = ctx.camRight;
    const camU = ctx.camUp;
    const zOff = cfg.zOffset || 0;
    for (let j = 0; j < this.alive; j++) {
      const t = this.age[j] / this.life[j];
      const jit = this.seed[j];
      posA[j * 3] = this.px[j] - camF.x * zOff;
      posA[j * 3 + 1] = this.py[j] - camF.y * zOff;
      posA[j * 3 + 2] = this.pz[j] - camF.z * zOff;
      evalColorSeq(cfg.colorSeq, t, colTmp);
      colA[j * 3] = colTmp.r; colA[j * 3 + 1] = colTmp.g; colA[j * 3 + 2] = colTmp.b;
      ligA[j * 3] = this.lr[j]; ligA[j * 3 + 1] = this.lg[j]; ligA[j * 3 + 2] = this.lb[j];
      alpA[j] = Math.min(1, Math.max(0, 1 - evalNumberSeq(cfg.transpSeq, t, jit)));
      sizA[j] = Math.max(0, evalNumberSeq(cfg.sizeSeq, t, jit));
      sqA[j] = cfg.squashSeq ? evalNumberSeq(cfg.squashSeq, t, jit) : 0;
      frmA[j] = cells > 1 ? (this.age[j] * Math.max(0, cfg.fbFps)) % (cells * cells) : 0;

      if (cfg.orientation === "VelocityParallel" || cfg.orientation === "VelocityPerpendicular") {
        const sx = this.vx[j] * camR.x + this.vy[j] * camR.y + this.vz[j] * camR.z;
        const sy = this.vx[j] * camU.x + this.vy[j] * camU.y + this.vz[j] * camU.z;
        let a = Math.atan2(sy, sx) - Math.PI / 2;
        if (cfg.orientation === "VelocityPerpendicular") a += Math.PI / 2;
        rotA[j] = a;
      } else {


        rotA[j] = this.rot[j];
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aRot.needsUpdate = true;
    this.geo.attributes.aFrame.needsUpdate = true;
    this.geo.attributes.aSquash.needsUpdate = true;
    this.geo.attributes.aLight.needsUpdate = true;
    this.geo.setDrawRange(0, this.alive);
    this.mat.uniforms.uCells.value = cells;
    this.mat.uniforms.uPixelScale.value = ctx.pixelScale;
    this.points.visible = this.alive > 0;
  }

  dispose() {
    if (this.points.parent) this.points.parent.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
    this.alive = 0;
  }
}


function rangeOf(inst, prop, defMin, defMax, lo, hi) {
  const v = inst.hasProperty(prop) ? inst.getProperty(prop) : null;
  let mn = v && Number.isFinite(v.min) ? v.min : defMin;
  let mx = v && Number.isFinite(v.max) ? v.max : defMax;
  mn = clampN(mn, lo, hi, defMin);
  mx = clampN(mx, lo, hi, defMax);
  return { min: Math.min(mn, mx), max: Math.max(mn, mx) };
}

function seqOf(inst, prop, fallback) {
  const v = inst.hasProperty(prop) ? inst.getProperty(prop) : null;
  return v && Array.isArray(v.keypoints) && v.keypoints.length >= 2 ? v : fallback;
}

function flatNumSeq(v, env) {
  return { keypoints: [{ time: 0, value: v, envelope: env || 0 }, { time: 1, value: v, envelope: env || 0 }] };
}

const SEQ_ZERO = flatNumSeq(0);
const SEQ_ONE = flatNumSeq(1);
const SEQ_WHITE = { keypoints: [{ time: 0, color: { r: 1, g: 1, b: 1 } }, { time: 1, color: { r: 1, g: 1, b: 1 } }] };

function colorOf(inst, prop, fb) {
  const c = inst.hasProperty(prop) ? inst.getProperty(prop) : null;
  return c && Number.isFinite(c.r) ? c : fb;
}


function cfgFromParticleEmitter(inst) {
  const life = rangeOf(inst, "Lifetime", 5, 10, 0.05, 60);
  const speed = rangeOf(inst, "Speed", 5, 5, 0, 1000);
  const rotS = rangeOf(inst, "RotSpeed", 0, 0, -3600, 3600);
  const rot0 = rangeOf(inst, "Rotation", 0, 0, -3600, 3600);
  const spread = inst.getProperty("SpreadAngle") || { x: 0, y: 0 };
  const accel = inst.getProperty("Acceleration") || { x: 0, y: 0, z: 0 };
  const texture = String(inst.getProperty("Texture") || "");
  const lightEmission = clampN(inst.getProperty("LightEmission"), 0, 1, 0);
  return {
    enabled: inst.getProperty("Enabled") !== false,
    rate: clampN(inst.getProperty("Rate"), 0, MAX_RATE, 20),
    lifeMin: life.min, lifeMax: life.max,
    speedMin: speed.min, speedMax: speed.max,
    spreadX: clampN(spread.x, 0, 360, 0), spreadY: clampN(spread.y, 0, 360, 0),
    accelX: numOr(accel.x, 0), accelY: numOr(accel.y, 0), accelZ: numOr(accel.z, 0),
    drag: clampN(inst.getProperty("Drag"), 0, 100, 0),
    velInherit: clampN(inst.getProperty("VelocityInheritance"), 0, 1, 0),
    rotSpeedMin: rotS.min, rotSpeedMax: rotS.max,
    rotMin: rot0.min, rotMax: rot0.max,
    emissionDirection: String(inst.getProperty("EmissionDirection") || "Top"),
    shape: String(inst.getProperty("Shape") || "Box"),
    shapeStyle: String(inst.getProperty("ShapeStyle") || "Volume"),
    sizeSeq: seqOf(inst, "Size", SEQ_ONE),
    transpSeq: seqOf(inst, "Transparency", SEQ_ZERO),
    colorSeq: seqOf(inst, "Color", SEQ_WHITE),
    squashSeq: seqOf(inst, "Squash", null),
    zOffset: clampN(inst.getProperty("ZOffset"), -100, 100, 0),
    locked: inst.getProperty("LockedToPart") === true,
    orientation: String(inst.getProperty("Orientation") || "FacingCamera"),
    windAffectsDrag: inst.getProperty("WindAffectsDrag") === true,
    fbFps: clampN(inst.getProperty("FlipbookFramesPerSecond"), 0, 60, 8),
    flipbookLayout: String(inst.getProperty("FlipbookLayout") || "None"),



    additive: lightEmission >= 0.5,


    lightEmission,
    lightInfluence: clampN(inst.getProperty("LightInfluence"), 0, 1, 1),
    texKind: texture ? "asset" : "dot",
    texAsset: texture,
    timeScale: 1,
    sizeOverride: null,
  };
}


function cfgFromFire(inst) {
  const size = clampN(inst.getProperty("Size"), 2, 30, 5);
  const heat = clampN(inst.getProperty("Heat"), 5, 25, 9);
  const ts = clampN(inst.getProperty("TimeScale"), 0, 1, 1);
  const color = colorOf(inst, "Color", { r: 0.93, g: 0.55, b: 0.2 });
  const secondary = colorOf(inst, "SecondaryColor", { r: 0.86, g: 0.26, b: 0.05 });
  return {
    enabled: inst.getProperty("Enabled") !== false,
    rate: Math.min(60, 12 + size * 1.6),
    lifeMin: 0.45, lifeMax: 0.85,
    speedMin: heat * 0.32, speedMax: heat * 0.5,
    spreadX: 16, spreadY: 16,
    accelX: 0, accelY: heat * 0.16, accelZ: 0,
    drag: 0, velInherit: 0,
    rotSpeedMin: -25, rotSpeedMax: 25,
    rotMin: -15, rotMax: 15,
    emissionDirection: "Top", shape: "Box", shapeStyle: "Volume",
    sizeSeq: { keypoints: [
      { time: 0, value: size * 0.5, envelope: size * 0.12 },
      { time: 0.55, value: size * 0.3, envelope: size * 0.06 },
      { time: 1, value: size * 0.07, envelope: 0 },
    ] },
    transpSeq: { keypoints: [
      { time: 0, value: 0.25, envelope: 0.1 },
      { time: 0.7, value: 0.5, envelope: 0.1 },
      { time: 1, value: 1, envelope: 0 },
    ] },

    colorSeq: { keypoints: [
      { time: 0, color: { r: secondary.r, g: secondary.g, b: secondary.b } },
      { time: 0.4, color: { r: color.r, g: color.g, b: color.b } },
      { time: 1, color: { r: color.r * 0.55, g: color.g * 0.45, b: color.b * 0.35 } },
    ] },
    squashSeq: null,
    zOffset: 0, locked: false,
    orientation: "FacingCamera", windAffectsDrag: false,
    fbFps: 0, flipbookLayout: "None",
    additive: true,
    lightInfluence: 0,                                           
    texKind: "flame", texAsset: "",
    timeScale: ts,
    sizeOverride: { x: Math.max(0.4, size * 0.32), y: 0.25, z: Math.max(0.4, size * 0.32) },
  };
}


function cfgFromSmoke(inst) {
  const size = clampN(inst.getProperty("Size"), 1, 100, 1);
  const opacity = clampN(inst.getProperty("Opacity"), 0, 1, 0.5);
  const rise = clampN(inst.getProperty("RiseVelocity"), -25, 25, 1);
  const ts = clampN(inst.getProperty("TimeScale"), 0, 1, 1);
  const color = colorOf(inst, "Color", { r: 0.7, g: 0.7, b: 0.72 });
  const riseMag = Math.abs(rise);
  return {
    enabled: inst.getProperty("Enabled") !== false,
    rate: 9,
    lifeMin: 2.2, lifeMax: 3.4,
    speedMin: riseMag * 0.22 + 0.5, speedMax: riseMag * 0.4 + 1,
    spreadX: 12, spreadY: 12,
    accelX: 0, accelY: rise * 0.18, accelZ: 0,
    drag: 0, velInherit: 0,
    rotSpeedMin: -10, rotSpeedMax: 10,
    rotMin: -180, rotMax: 180,
    emissionDirection: rise >= 0 ? "Top" : "Bottom", shape: "Box", shapeStyle: "Volume",
    sizeSeq: { keypoints: [
      { time: 0, value: Math.max(0.8, size * 1.4), envelope: size * 0.3 },
      { time: 1, value: Math.max(1.6, size * 4), envelope: size * 0.4 },
    ] },
    transpSeq: { keypoints: [
      { time: 0, value: 1 - opacity * 0.85, envelope: 0.08 },
      { time: 0.7, value: 1 - opacity * 0.45, envelope: 0.08 },
      { time: 1, value: 1, envelope: 0 },
    ] },
    colorSeq: { keypoints: [
      { time: 0, color: { r: color.r, g: color.g, b: color.b } },
      { time: 1, color: { r: color.r, g: color.g, b: color.b } },
    ] },
    squashSeq: null,
    zOffset: 0, locked: false,
    orientation: "FacingCamera", windAffectsDrag: false,
    fbFps: 0, flipbookLayout: "None",
    additive: false,
    lightInfluence: 1,                                            
    texKind: "smoke", texAsset: "",
    timeScale: ts,
    sizeOverride: { x: Math.max(0.5, size * 0.5), y: 0.3, z: Math.max(0.5, size * 0.5) },
  };
}


function cfgFromSparkles(inst) {
  const ts = clampN(inst.getProperty("TimeScale"), 0, 1, 1);
  const color = colorOf(inst, "SparkleColor", { r: 0.98, g: 0.85, b: 0.25 });
  return {
    enabled: inst.getProperty("Enabled") !== false,
    rate: 28,
    lifeMin: 0.45, lifeMax: 1.1,
    speedMin: 0.6, speedMax: 2.2,
    spreadX: 360, spreadY: 360,
    accelX: 0, accelY: 0.4, accelZ: 0,
    drag: 1.5, velInherit: 0,
    rotSpeedMin: -240, rotSpeedMax: 240,
    rotMin: -180, rotMax: 180,
    emissionDirection: "Top", shape: "Sphere", shapeStyle: "Volume",
    sizeSeq: { keypoints: [
      { time: 0, value: 0.5, envelope: 0.3 },
      { time: 1, value: 0.05, envelope: 0 },
    ] },
    transpSeq: { keypoints: [
      { time: 0, value: 0.1, envelope: 0.55 },
      { time: 1, value: 1, envelope: 0 },
    ] },
    colorSeq: { keypoints: [
      { time: 0, color: { r: Math.min(1, color.r * 1.1 + 0.1), g: Math.min(1, color.g * 1.1 + 0.1), b: Math.min(1, color.b * 1.1 + 0.1) } },
      { time: 1, color: { r: color.r, g: color.g, b: color.b } },
    ] },
    squashSeq: null,
    zOffset: 0, locked: false,
    orientation: "FacingCamera", windAffectsDrag: false,
    fbFps: 0, flipbookLayout: "None",
    additive: true,
    lightInfluence: 0,                         
    texKind: "spark", texAsset: "",
    timeScale: ts,
    sizeOverride: { x: 2.4, y: 2.4, z: 2.4 },
  };
}

const EMITTER_CFG_BUILDERS = {
  ParticleEmitter: cfgFromParticleEmitter,
  Fire: cfgFromFire,
  Smoke: cfgFromSmoke,
  Sparkles: cfgFromSparkles,
};


const TMP_SPHERE = new THREE.Sphere();
const TMP_PVEL = { x: 0, y: 0, z: 0 };

class EmitterController {
  constructor(inst, group, buildCfg) {
    this.inst = inst;
    this.group = group;
    this.buildCfg = buildCfg;
    this.pool = null;
    this.cfg = null;
    this.cfgDirty = true;
    this.acc = 0;
    this.burst = 0;
    this.lastPos = null;
    this.suppressed = false;                                       
  }

  markDirty() { this.cfgDirty = true; }

  emitBurst(n) { this.burst = Math.min(MAX_PARTICLES, this.burst + (n | 0)); }

  update(dt, ctx) {
    const inst = this.inst;
    if (inst.isDestroyed()) { this.disposePool(); return; }
    if (this.cfgDirty) {
      this.cfg = this.buildCfg(inst);
      this.cfgDirty = false;
      if (this.pool) {
        this.pool.setTexture(getEffectTexture(this.cfg.texKind, this.cfg.texAsset));
        this.pool.setBlending(this.cfg.additive);
      }
    }
    const cfg = this.cfg;
    const part = inst.getParent();
    const sdt = dt * cfg.timeScale;
    if (!isBasePart(part)) {

      if (this.pool && this.pool.alive > 0) this.pool.update(sdt, cfg, ctx, 0, 0, 0);
      else this.disposePool();
      return;
    }
    const pose = partPose(part);
    const size3 = cfg.sizeOverride || partSize(part);

    const infl = cfg.lightInfluence > 0 ? Math.min(cfg.lightInfluence, 1) : 0;
    const sampler = infl > 0 && ctx.sampleLight ? ctx.sampleLight : null;

    let ldx = 0; let ldy = 0; let ldz = 0;
    TMP_PVEL.x = 0; TMP_PVEL.y = 0; TMP_PVEL.z = 0;
    if (this.lastPos) {
      ldx = pose.pos.x - this.lastPos.x;
      ldy = pose.pos.y - this.lastPos.y;
      ldz = pose.pos.z - this.lastPos.z;
      if (dt > 1e-4) {
        TMP_PVEL.x = ldx / dt; TMP_PVEL.y = ldy / dt; TMP_PVEL.z = ldz / dt;
      }
      this.lastPos.copy(pose.pos);
    } else {
      this.lastPos = pose.pos.clone();
    }
    if (!cfg.locked) { ldx = 0; ldy = 0; ldz = 0; }

    const wantSpawn = cfg.enabled && !this.suppressed && sdt > 0;
    if (wantSpawn) {
      const dist = ctx.camPos.distanceTo(pose.pos);
      const visR = cfg.lifeMax * Math.max(1, cfg.speedMax) + Math.max(size3.x, Math.max(size3.y, size3.z)) + 6;
      TMP_SPHERE.center.copy(pose.pos);
      TMP_SPHERE.radius = visR;
      const inView = ctx.frustum.intersectsSphere(TMP_SPHERE);
      let lod = 1;
      if (dist > LOD_FAR) lod = 0.25;
      else if (dist > LOD_NEAR) lod = 1 - 0.75 * ((dist - LOD_NEAR) / (LOD_FAR - LOD_NEAR));
      if (inView) {

        this.acc += clampN(cfg.rate, 0, MAX_RATE, 0) * lod * emitQualityScale * sdt;
        let n = Math.floor(this.acc);
        this.acc -= n;
        n += this.burst;
        this.burst = 0;
        if (n > 0) {
          this.ensurePool();
          this.pool.spawn(n, cfg, pose, size3, TMP_PVEL, sampler);
        }
      } else {

        this.acc = 0;
        this.burst = 0;
      }
    } else {
      this.acc = 0;
      if (!cfg.enabled) this.burst = 0;
    }
    if (this.pool) {
      if (this.pool.alive === 0 && (!cfg.enabled || this.suppressed)) {

        this.disposePool();
        return;
      }


      this.pool.setLightInfluence(sampler ? infl : 0);


      this.pool.setEmissiveBoost(particleEmissionBoost(cfg.lightEmission, getEmissiveRenderStyle()));
      if (sampler) this.pool.sampleLights(sampler, LIGHT_RESAMPLE_BUDGET);
      this.pool.update(sdt, cfg, ctx, ldx, ldy, ldz);
    }
  }

  ensurePool() {
    const cfg = this.cfg;
    const cap = Math.min(MAX_PARTICLES, Math.ceil(clampN(cfg.rate, 0, MAX_RATE, 0) * Math.max(0.1, cfg.lifeMax)) + 40);
    if (this.pool && this.pool.cap < cap) { this.pool.dispose(); this.pool = null; }
    if (!this.pool) {
      this.pool = new ParticlePool(this.group, cap, getEffectTexture(cfg.texKind, cfg.texAsset), cfg.additive);
    }
  }

  isEnabled() { return !!(this.cfg && this.cfg.enabled); }

  active() {
    if (this.pool && this.pool.alive > 0) return true;
    return !!(this.cfg && this.cfg.enabled && !this.suppressed && this.cfg.rate > 0 && this.cfg.timeScale > 0);
  }

  disposePool() { if (this.pool) { this.pool.dispose(); this.pool = null; } }

  dispose() { this.disposePool(); }
}


const MAX_BEAM_SEG = 100;

const STRIP_VERT = `
attribute vec4 aCol;
varying vec4 vCol;
varying vec2 vUv;
void main() {
  vCol = aCol;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const STRIP_FRAG = `
uniform sampler2D uMap;
uniform float uOffset;
uniform float uEmissiveBoost;
varying vec4 vCol;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(fract(vUv.x + uOffset), vUv.y);
  vec4 tex = texture2D(uMap, uv);
  gl_FragColor = tex * vCol;
                                                                        
  gl_FragColor.rgb *= uEmissiveBoost;
  if (gl_FragColor.a < 0.01) discard;
}
`;


function getStripTexture() {
  if (textureCache.has("strip")) return textureCache.get("strip");
  const c = makeCanvas(32);
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 32);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.25, "rgba(255,255,255,1)");
  g.addColorStop(0.75, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  textureCache.set("strip", tex);
  return tex;
}

function makeStripMesh(group, maxColumns) {
  const verts = maxColumns * 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aCol", new THREE.BufferAttribute(new Float32Array(verts * 4), 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(verts * 2), 2).setUsage(THREE.DynamicDrawUsage));
  const idx = new Uint16Array((maxColumns - 1) * 6);
  for (let i = 0; i < maxColumns - 1; i++) {
    const a = i * 2;
    idx[i * 6] = a; idx[i * 6 + 1] = a + 1; idx[i * 6 + 2] = a + 2;
    idx[i * 6 + 3] = a + 1; idx[i * 6 + 4] = a + 3; idx[i * 6 + 5] = a + 2;
  }
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: getStripTexture() }, uOffset: { value: 0 }, uEmissiveBoost: { value: 1 } },
    vertexShader: STRIP_VERT,
    fragmentShader: STRIP_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  group.add(mesh);
  return mesh;
}

const TMP_V1 = new THREE.Vector3();
const TMP_V2 = new THREE.Vector3();
const TMP_V3 = new THREE.Vector3();
const TMP_V4 = new THREE.Vector3();
const TMP_TAN = new THREE.Vector3();
const TMP_SIDE = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TMP_COL = { r: 1, g: 1, b: 1 };

function attRef(inst, prop) {
  const a = inst.getProperty(prop);
  return a && a.className === "Attachment" && !a.isDestroyed() ? a : null;
}

class BeamController {
  constructor(inst, group) {
    this.inst = inst;
    this.group = group;
    this.mesh = null;
    this.cfg = null;
    this.cfgDirty = true;
    this.scroll = 0;
    this.pendingOffset = null;
    this.lastHash = "";
    this.changed = false;
    this.scrolling = false;
  }


  setTextureOffset(offset) {
    const o = Number(offset) || 0;
    this.pendingOffset = ((o % 1) + 1) % 1;
    this.applyTextureOffset();
  }


  applyTextureOffset() {
    if (this.pendingOffset === null || !this.mesh) return;
    this.scroll = -this.pendingOffset;
    this.mesh.material.uniforms.uOffset.value = this.scroll;
    this.pendingOffset = null;
    this.changed = true;
  }

  markDirty() { this.cfgDirty = true; }

  readCfg() {
    const inst = this.inst;
    const texture = String(inst.getProperty("Texture") || "");
    this.cfg = {
      enabled: inst.getProperty("Enabled") !== false,
      colorSeq: seqOf(inst, "Color", SEQ_WHITE),
      transpSeq: seqOf(inst, "Transparency", SEQ_ZERO),
      w0: Math.max(0, numOr(inst.getProperty("Width0"), 1)),
      w1: Math.max(0, numOr(inst.getProperty("Width1"), 1)),
      textureLength: Math.max(0.05, numOr(inst.getProperty("TextureLength"), 1)),
      textureMode: String(inst.getProperty("TextureMode") || "Stretch"),
      textureSpeed: numOr(inst.getProperty("TextureSpeed"), 0),
      additive: clampN(inst.getProperty("LightEmission"), 0, 1, 0) >= 0.5,

      lightEmission: clampN(inst.getProperty("LightEmission"), 0, 1, 0),
      faceCamera: inst.getProperty("FaceCamera") === true,
      segments: Math.round(clampN(inst.getProperty("Segments"), 1, MAX_BEAM_SEG, 10)),
      curve0: numOr(inst.getProperty("CurveSize0"), 0),
      curve1: numOr(inst.getProperty("CurveSize1"), 0),
      zOffset: clampN(inst.getProperty("ZOffset"), -100, 100, 0),
      texKind: texture ? "asset" : "strip",
      texAsset: texture,
    };
  }

  update(dt, ctx) {
    const inst = this.inst;
    if (inst.isDestroyed()) { this.dispose(); return; }
    if (this.cfgDirty) { this.readCfg(); this.cfgDirty = false; this.applyMaterial(); }
    const cfg = this.cfg;
    const att0 = attRef(inst, "Attachment0");
    const att1 = attRef(inst, "Attachment1");
    const wa = att0 ? attachmentWorld(att0) : null;
    const wb = att1 ? attachmentWorld(att1) : null;
    if (!cfg.enabled || !wa || !wb) {
      if (this.mesh) this.mesh.visible = false;
      this.changed = false;
      this.scrolling = false;
      return;
    }
    if (!this.mesh) { this.mesh = makeStripMesh(this.group, MAX_BEAM_SEG + 1); this.applyMaterial(); }
    this.mesh.visible = true;

    this.mesh.material.uniforms.uEmissiveBoost.value = particleEmissionBoost(cfg.lightEmission, getEmissiveRenderStyle());
    const seg = cfg.segments;
    const cols = seg + 1;

    const p0 = TMP_V1.copy(wa.pos);
    const p3 = TMP_V2.copy(wb.pos);
    const h0 = TMP_V3.set(1, 0, 0).applyQuaternion(wa.quat).multiplyScalar(cfg.curve0).add(p0);
    const h1 = TMP_V4.set(1, 0, 0).applyQuaternion(wb.quat).multiplyScalar(-cfg.curve1).add(p3);
    const posA = this.mesh.geometry.attributes.position.array;
    const colA = this.mesh.geometry.attributes.aCol.array;
    const uvA = this.mesh.geometry.attributes.uv.array;
    let arcLen = 0;
    let prevX = 0; let prevY = 0; let prevZ = 0;
    for (let i = 0; i < cols; i++) {
      const t = i / seg;
      const it = 1 - t;

      const bx = it * it * it * p0.x + 3 * it * it * t * h0.x + 3 * it * t * t * h1.x + t * t * t * p3.x;
      const by = it * it * it * p0.y + 3 * it * it * t * h0.y + 3 * it * t * t * h1.y + t * t * t * p3.y;
      const bz = it * it * it * p0.z + 3 * it * it * t * h0.z + 3 * it * t * t * h1.z + t * t * t * p3.z;

      TMP_TAN.set(
        3 * it * it * (h0.x - p0.x) + 6 * it * t * (h1.x - h0.x) + 3 * t * t * (p3.x - h1.x),
        3 * it * it * (h0.y - p0.y) + 6 * it * t * (h1.y - h0.y) + 3 * t * t * (p3.y - h1.y),
        3 * it * it * (h0.z - p0.z) + 6 * it * t * (h1.z - h0.z) + 3 * t * t * (p3.z - h1.z),
      );
      if (TMP_TAN.lengthSq() < 1e-8) TMP_TAN.subVectors(p3, p0);

      TMP_SIDE.crossVectors(TMP_TAN, cfg.faceCamera ? ctx.camForward : WORLD_UP);
      if (TMP_SIDE.lengthSq() < 1e-8) TMP_SIDE.crossVectors(TMP_TAN, ctx.camRight);
      if (TMP_SIDE.lengthSq() < 1e-8) TMP_SIDE.set(0, 1, 0);
      TMP_SIDE.normalize();
      const half = (cfg.w0 + (cfg.w1 - cfg.w0) * t) * 0.5;
      const ox = -ctx.camForward.x * cfg.zOffset;
      const oy = -ctx.camForward.y * cfg.zOffset;
      const oz = -ctx.camForward.z * cfg.zOffset;
      posA[i * 6] = bx + TMP_SIDE.x * half + ox;
      posA[i * 6 + 1] = by + TMP_SIDE.y * half + oy;
      posA[i * 6 + 2] = bz + TMP_SIDE.z * half + oz;
      posA[i * 6 + 3] = bx - TMP_SIDE.x * half + ox;
      posA[i * 6 + 4] = by - TMP_SIDE.y * half + oy;
      posA[i * 6 + 5] = bz - TMP_SIDE.z * half + oz;

      evalColorSeq(cfg.colorSeq, t, TMP_COL);
      const alpha = Math.min(1, Math.max(0, 1 - evalNumberSeq(cfg.transpSeq, t)));
      for (let k = 0; k < 2; k++) {
        colA[(i * 2 + k) * 4] = TMP_COL.r;
        colA[(i * 2 + k) * 4 + 1] = TMP_COL.g;
        colA[(i * 2 + k) * 4 + 2] = TMP_COL.b;
        colA[(i * 2 + k) * 4 + 3] = alpha;
      }

      if (i > 0) {
        const ddx = bx - prevX; const ddy = by - prevY; const ddz = bz - prevZ;
        arcLen += Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      }
      prevX = bx; prevY = by; prevZ = bz;
      const u = cfg.textureMode === "Wrap" ? arcLen / cfg.textureLength : t;
      uvA[(i * 2) * 2] = u; uvA[(i * 2) * 2 + 1] = 1;
      uvA[(i * 2 + 1) * 2] = u; uvA[(i * 2 + 1) * 2 + 1] = 0;
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aCol.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.setDrawRange(0, seg * 6);

    this.applyTextureOffset();

    this.scrolling = cfg.textureMode !== "Static" && Math.abs(cfg.textureSpeed) > 1e-4;
    if (this.scrolling) {
      this.scroll = (this.scroll - cfg.textureSpeed * dt) % 1;
      this.mesh.material.uniforms.uOffset.value = this.scroll;
    }

    const hash = `${wa.pos.x.toFixed(3)},${wa.pos.y.toFixed(3)},${wa.pos.z.toFixed(3)}|${wb.pos.x.toFixed(3)},${wb.pos.y.toFixed(3)},${wb.pos.z.toFixed(3)}|${seg}|${cfg.w0},${cfg.w1}|${cfg.faceCamera ? ctx.camHash : ""}`;
    this.changed = hash !== this.lastHash;
    this.lastHash = hash;
  }

  applyMaterial() {
    if (!this.mesh || !this.cfg) return;
    this.mesh.material.uniforms.uMap.value = this.cfg.texKind === "asset" ? getEffectTexture("asset", this.cfg.texAsset) : getStripTexture();
    const b = this.cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (this.mesh.material.blending !== b) { this.mesh.material.blending = b; this.mesh.material.needsUpdate = true; }
  }

  active() { return !!(this.mesh && this.mesh.visible && (this.scrolling || this.changed)); }

  dispose() {
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }
}


class TrailController {
  constructor(inst, group) {
    this.inst = inst;
    this.group = group;
    this.mesh = null;
    this.cfg = null;
    this.cfgDirty = true;
    this.records = [];                                         
    this.clock = 0;
    this.moving = false;
  }

  markDirty() { this.cfgDirty = true; }

  readCfg() {
    const inst = this.inst;
    const texture = String(inst.getProperty("Texture") || "");
    this.cfg = {
      enabled: inst.getProperty("Enabled") !== false,
      colorSeq: seqOf(inst, "Color", SEQ_WHITE),
      transpSeq: seqOf(inst, "Transparency", SEQ_ZERO),
      lifetime: clampN(inst.getProperty("Lifetime"), 0.05, 20, 2),
      minLength: Math.max(0.01, numOr(inst.getProperty("MinLength"), 0.1)),
      maxLength: Math.max(0.05, numOr(inst.getProperty("MaxLength"), 10)),
      textureLength: Math.max(0.05, numOr(inst.getProperty("TextureLength"), 1)),
      textureMode: String(inst.getProperty("TextureMode") || "Stretch"),
      additive: clampN(inst.getProperty("LightEmission"), 0, 1, 0) >= 0.5,

      lightEmission: clampN(inst.getProperty("LightEmission"), 0, 1, 0),
      faceCamera: inst.getProperty("FaceCamera") === true,
      widthSeq: seqOf(inst, "WidthScale", SEQ_ONE),
      texKind: texture ? "asset" : "strip",
      texAsset: texture,
    };
  }

  applyMaterial() {
    if (!this.mesh || !this.cfg) return;
    this.mesh.material.uniforms.uMap.value = this.cfg.texKind === "asset" ? getEffectTexture("asset", this.cfg.texAsset) : getStripTexture();
    const b = this.cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (this.mesh.material.blending !== b) { this.mesh.material.blending = b; this.mesh.material.needsUpdate = true; }
  }

  update(dt, ctx) {
    const inst = this.inst;
    if (inst.isDestroyed()) { this.dispose(); return; }
    if (this.cfgDirty) { this.readCfg(); this.cfgDirty = false; this.applyMaterial(); }
    const cfg = this.cfg;
    this.clock += dt;

    while (this.records.length && this.clock - this.records[0].t > cfg.lifetime) this.records.shift();
    const att0 = attRef(inst, "Attachment0");
    const att1 = attRef(inst, "Attachment1");
    const wa = att0 ? attachmentWorld(att0) : null;
    const wb = att1 ? attachmentWorld(att1) : null;
    this.moving = false;
    const hasHead = !!(cfg.enabled && wa && wb);
    if (hasHead) {
      const last = this.records.length ? this.records[this.records.length - 1] : null;
      if (!last) {
        this.records.push({ ax: wa.pos.x, ay: wa.pos.y, az: wa.pos.z, bx: wb.pos.x, by: wb.pos.y, bz: wb.pos.z, t: this.clock });
      } else {

        const mx = (wa.pos.x + wb.pos.x) * 0.5;
        const my = (wa.pos.y + wb.pos.y) * 0.5;
        const mz = (wa.pos.z + wb.pos.z) * 0.5;
        const lx = (last.ax + last.bx) * 0.5;
        const ly = (last.ay + last.by) * 0.5;
        const lz = (last.az + last.bz) * 0.5;
        const dx = mx - lx; const dy = my - ly; const dz = mz - lz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist >= cfg.minLength) {
          this.moving = true;
          this.records.push({ ax: wa.pos.x, ay: wa.pos.y, az: wa.pos.z, bx: wb.pos.x, by: wb.pos.y, bz: wb.pos.z, t: this.clock });
          if (this.records.length > TRAIL_MAX_RECORDS) this.records.shift();
        }
      }
    } else if (!cfg.enabled) {
      this.records.length = 0;
    }
    const n = this.records.length + (hasHead ? 1 : 0);
    if (n < 2) {
      if (this.mesh) this.mesh.visible = false;
      return;
    }
    if (!this.mesh) { this.mesh = makeStripMesh(this.group, TRAIL_MAX_RECORDS + 2); this.applyMaterial(); }
    this.mesh.visible = true;

    this.mesh.material.uniforms.uEmissiveBoost.value = particleEmissionBoost(cfg.lightEmission, getEmissiveRenderStyle());
    const posA = this.mesh.geometry.attributes.position.array;
    const colA = this.mesh.geometry.attributes.aCol.array;
    const uvA = this.mesh.geometry.attributes.uv.array;
    let arc = 0;
    let pmx = 0; let pmy = 0; let pmz = 0;
    for (let i = 0; i < n; i++) {
      let ax; let ay; let az; let bx; let by; let bz; let t0;
      if (i < this.records.length) {
        const r = this.records[i];
        ax = r.ax; ay = r.ay; az = r.az; bx = r.bx; by = r.by; bz = r.bz; t0 = r.t;
      } else {
        ax = wa.pos.x; ay = wa.pos.y; az = wa.pos.z; bx = wb.pos.x; by = wb.pos.y; bz = wb.pos.z; t0 = this.clock;
      }
      const ageT = Math.min(1, Math.max(0, (this.clock - t0) / cfg.lifetime));

      const w = Math.max(0, evalNumberSeq(cfg.widthSeq, ageT));
      const cx = (ax + bx) * 0.5;
      const cy = (ay + by) * 0.5;
      const cz = (az + bz) * 0.5;
      posA[i * 6] = cx + (ax - cx) * w;
      posA[i * 6 + 1] = cy + (ay - cy) * w;
      posA[i * 6 + 2] = cz + (az - cz) * w;
      posA[i * 6 + 3] = cx + (bx - cx) * w;
      posA[i * 6 + 4] = cy + (by - cy) * w;
      posA[i * 6 + 5] = cz + (bz - cz) * w;
      evalColorSeq(cfg.colorSeq, ageT, TMP_COL);
      const alpha = Math.min(1, Math.max(0, 1 - evalNumberSeq(cfg.transpSeq, ageT)));
      for (let k = 0; k < 2; k++) {
        colA[(i * 2 + k) * 4] = TMP_COL.r;
        colA[(i * 2 + k) * 4 + 1] = TMP_COL.g;
        colA[(i * 2 + k) * 4 + 2] = TMP_COL.b;
        colA[(i * 2 + k) * 4 + 3] = alpha;
      }
      if (i > 0) {
        const ddx = cx - pmx; const ddy = cy - pmy; const ddz = cz - pmz;
        arc += Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      }
      pmx = cx; pmy = cy; pmz = cz;
      const u = cfg.textureMode === "Wrap" ? arc / cfg.textureLength : i / (n - 1);
      uvA[(i * 2) * 2] = u; uvA[(i * 2) * 2 + 1] = 1;
      uvA[(i * 2 + 1) * 2] = u; uvA[(i * 2 + 1) * 2 + 1] = 0;
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aCol.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
  }

  active() { return this.records.length > 0; }

  dispose() {
    this.records.length = 0;
    if (this.mesh) {
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
  }
}


let _ffGeo = null;
function forceFieldGeo() {
  if (!_ffGeo) _ffGeo = new THREE.SphereGeometry(1, 24, 18);
  return _ffGeo;
}

class ForceFieldController {
  constructor(inst, group) {
    this.inst = inst;
    this.group = group;
    this.mesh = new THREE.Mesh(forceFieldGeo(), new THREE.MeshBasicMaterial({
      color: 0x3aa6ff,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }));
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    group.add(this.mesh);
    this.clock = 0;
  }

  markDirty() {}

  update(dt, _ctx) {
    if (this.inst.isDestroyed()) { this.mesh.visible = false; return; }
    const character = typeof this.inst.getParent === "function" ? this.inst.getParent() : null;
    if (!character || this.inst.getProperty("Visible") === false) { this.mesh.visible = false; return; }
    const parts = typeof character.getDescendants === "function" ? character.getDescendants() : character.getChildren();
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let any = false;
    for (const p of parts) {
      if (!isBasePart(p)) continue;
      const pose = partPose(p);
      const size = partSize(p);
      const r = Math.max(size.x, size.y, size.z) * 0.5;
      if (pose.pos.x - r < minX) minX = pose.pos.x - r;
      if (pose.pos.y - r < minY) minY = pose.pos.y - r;
      if (pose.pos.z - r < minZ) minZ = pose.pos.z - r;
      if (pose.pos.x + r > maxX) maxX = pose.pos.x + r;
      if (pose.pos.y + r > maxY) maxY = pose.pos.y + r;
      if (pose.pos.z + r > maxZ) maxZ = pose.pos.z + r;
      any = true;
    }
    if (!any) { this.mesh.visible = false; return; }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const rx = Math.max(1.2, (maxX - minX) / 2 + 0.6);
    const ry = Math.max(1.6, (maxY - minY) / 2 + 0.6);
    const rz = Math.max(1.2, (maxZ - minZ) / 2 + 0.6);
    this.mesh.position.set(cx, cy, cz);
    this.mesh.scale.set(rx, ry, rz);
    this.clock += dt;
    this.mesh.material.opacity = 0.2 + 0.08 * (0.5 + 0.5 * Math.sin(this.clock * 3));
    this.mesh.visible = true;
  }

  active() { return this.mesh.visible; }

  dispose() {
    this.group.remove(this.mesh);
    if (this.mesh.material) this.mesh.material.dispose();
  }
}

let _explosionGeo = null;
function explosionGeo() {
  if (!_explosionGeo) _explosionGeo = new THREE.SphereGeometry(1, 20, 14);
  return _explosionGeo;
}





let emitQualityScale = 1;
export function setEffectsQualityScale(f) {
  const v = Number(f);
  emitQualityScale = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}
export function getEffectsQualityScale() {
  return emitQualityScale;
}

export function initEffectsRenderer({ scene, camera, renderer, requestRender, sampleLight }) {
  const group = new THREE.Group();
  group.name = "EffectsGroup";
  scene.add(group);

  const controllers = new Map();                         
  const seenExplosions = new Set();
  const explosionAnims = [];
  const subs = [];
  let structureDirty = true;
  let warnedCap = false;
  let disposed = false;
  let clock = 0;

  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  const camForward = new THREE.Vector3();
  const camRight = new THREE.Vector3();
  const camUp = new THREE.Vector3();


  const ctx = { camPos, camForward, camRight, camUp, frustum, pixelScale: 600, time: 0, camHash: "", sampleLight: typeof sampleLight === "function" ? sampleLight : null };

  function controllerFor(inst) {
    const cls = inst.className;
    if (EMITTER_CFG_BUILDERS[cls]) return new EmitterController(inst, group, EMITTER_CFG_BUILDERS[cls]);
    if (cls === "Beam") return new BeamController(inst, group);
    if (cls === "Trail") return new TrailController(inst, group);
    if (cls === "ForceField") return new ForceFieldController(inst, group);
    return null;
  }


  function triggerExplosion(inst) {
    const pos = inst.getProperty("Position") || { x: 0, y: 0, z: 0 };

    const radius = clampN(inst.getProperty("BlastRadius"), 0, 1000, 4);
    const pressure = clampN(inst.getProperty("BlastPressure"), 0, 1e6, 500000);
    const jointPercent = clampN(inst.getProperty("DestroyJointRadiusPercent"), 0, 1, 1);
    const visible = inst.getProperty("Visible") !== false;
    const ts = clampN(inst.getProperty("TimeScale"), 0, 1, 1);

    if (engine.mode !== "edit") {
      bus.emit("effects:explosionBlast", {
        x: numOr(pos.x, 0), y: numOr(pos.y, 0), z: numOr(pos.z, 0),
        radius, pressure, jointPercent,
      });
    }
    let mesh = null;
    if (visible) {
      mesh = new THREE.Mesh(explosionGeo(), new THREE.MeshBasicMaterial({
        color: 0xffa133,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      mesh.position.set(numOr(pos.x, 0), numOr(pos.y, 0), numOr(pos.z, 0));
      mesh.scale.setScalar(0.05);
      group.add(mesh);
    }
    explosionAnims.push({
      mesh,
      inst,
      t: 0,
      dur: 0.3 / Math.max(0.05, ts),
      radius: Math.max(1.5, radius * 0.6),
    });
    requestRender();
  }

  function updateExplosions(dt) {
    let i = 0;
    while (i < explosionAnims.length) {
      const a = explosionAnims[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      if (a.mesh) {

        a.mesh.scale.setScalar(Math.max(0.05, a.radius * Math.pow(k, 0.4)));
        a.mesh.material.opacity = 0.95 * (1 - k * k);
      }
      if (k >= 1) {

        if (a.mesh) { group.remove(a.mesh); a.mesh.material.dispose(); }

        try { if (a.inst && !a.inst.isDestroyed()) a.inst.destroy(); } catch (_err) {            }
        explosionAnims.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  function rescan() {
    const dm = store.getDataModel();
    const ws = dm && typeof dm.findFirstChild === "function" ? dm.findFirstChild("Workspace") : null;
    const found = new Set();
    if (ws) {
      const stack = [ws];
      while (stack.length) {
        const node = stack.pop();
        for (const ch of node.getChildren()) {
          const cls = ch.className;
          if (cls === "Explosion") {
            if (!seenExplosions.has(ch.id)) {
              seenExplosions.add(ch.id);
              triggerExplosion(ch);
            }
          } else if (EMITTER_CFG_BUILDERS[cls] || cls === "Beam" || cls === "Trail" || cls === "ForceField") {
            found.add(ch.id);
            if (!controllers.has(ch.id)) {
              const ctl = controllerFor(ch);
              if (ctl) controllers.set(ch.id, ctl);
            }
          }
          stack.push(ch);
        }
      }
    }

    for (const [id, ctl] of controllers) {
      if (!found.has(id)) {
        ctl.dispose();
        controllers.delete(id);
      }
    }

    let emitters = 0;
    for (const ctl of controllers.values()) {
      if (ctl instanceof EmitterController) {
        emitters++;
        const over = emitters > MAX_ACTIVE_EMITTERS;
        ctl.suppressed = over;
        if (over && !warnedCap) {
          warnedCap = true;
          logger.warn(`Efeitos: limite de ${MAX_ACTIVE_EMITTERS} emissores ativos atingido; emissores extras foram suspensos.`);
        }
      }
    }
  }

  subs.push(bus.on(Events.ChildAdded, () => { structureDirty = true; }));
  subs.push(bus.on(Events.ChildRemoved, () => { structureDirty = true; }));
  subs.push(bus.on(Events.PropertyChanged, (e) => {
    if (!e || !e.instance) return;
    const ctl = controllers.get(e.instance.id);
    if (ctl && typeof ctl.markDirty === "function") {
      ctl.markDirty();
      requestRender();
    }
  }));

  subs.push(bus.on("effects:emit", (e) => {
    if (!e || !e.instance) return;
    const ctl = controllers.get(e.instance.id);
    if (ctl instanceof EmitterController) {
      ctl.emitBurst(e.count || 1);
      requestRender();
    }
  }));

  subs.push(bus.on("effects:beamTextureOffset", (e) => {
    if (!e || !e.instance) return;
    const ctl = controllers.get(e.instance.id);
    if (ctl instanceof BeamController) {
      ctl.setTextureOffset(e.offset);
      requestRender();
    }
  }));


  let last = (typeof performance !== "undefined" ? performance.now() : Date.now());


  let unregisterFrameCallback = null;
  function tick(now) {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    clock += dt;
    if (structureDirty) { structureDirty = false; rescan(); }
    if (controllers.size === 0 && explosionAnims.length === 0) return;

    camera.updateMatrixWorld();
    camPos.setFromMatrixPosition(camera.matrixWorld);
    camera.getWorldDirection(camForward);
    camRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    camUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    ctx.pixelScale = ((renderer && renderer.domElement && renderer.domElement.clientHeight) || 600) * 0.9;
    ctx.time = clock;
    ctx.camHash = `${camPos.x.toFixed(2)},${camPos.y.toFixed(2)},${camPos.z.toFixed(2)}`;
    let anyActive = explosionAnims.length > 0;
    for (const ctl of controllers.values()) {
      ctl.update(dt, ctx);
      if (ctl.active()) anyActive = true;
    }
    updateExplosions(dt);
    if (anyActive) requestRender();
  }
  unregisterFrameCallback = registerFrameCallback("animation", tick, "effectsRender:effects");

  return {
    dispose() {
      disposed = true;
      if (unregisterFrameCallback) {
        unregisterFrameCallback();
        unregisterFrameCallback = null;
      }
      for (const off of subs) {
        try { if (typeof off === "function") off(); } catch (_err) {            }
      }
      subs.length = 0;
      for (const ctl of controllers.values()) ctl.dispose();
      controllers.clear();
      for (const a of explosionAnims) {
        if (a.mesh) { group.remove(a.mesh); a.mesh.material.dispose(); }
      }
      explosionAnims.length = 0;
      if (_explosionGeo) { _explosionGeo.dispose(); _explosionGeo = null; }
      if (_ffGeo) { _ffGeo.dispose(); _ffGeo = null; }
      for (const tex of textureCache.values()) {
        try { tex.dispose(); } catch (_err) {            }
      }
      textureCache.clear();
      scene.remove(group);
    },
  };
}
