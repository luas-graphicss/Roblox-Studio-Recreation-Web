import { AREA_LIGHT_BUDGETS, rectLightNits } from "./ltcCore.js";


export const AP_MAX_LIGHTS = AREA_LIGHT_BUDGETS.alto;


export const TUBE_CLAMPS = Object.freeze({
	length: Object.freeze({ min: 0.05, max: 64, def: 2 }),
	radius: Object.freeze({ min: 0.01, max: 8, def: 0.1 }),
});

function apNum(v, min, max, def) {
	const n = Number(v);
	if (!Number.isFinite(n)) return def;
	return n < min ? min : n > max ? max : n;
}

function dot3(ax, ay, az, bx, by, bz) {
	return ax * bx + ay * by + az * bz;
}

function clampf(v, a, b) {
	return v < a ? a : v > b ? b : v;
}

export function sanitizeTubeSize(length, radius) {
	return {
		length: apNum(length, TUBE_CLAMPS.length.min, TUBE_CLAMPS.length.max, TUBE_CLAMPS.length.def),
		radius: apNum(radius, TUBE_CLAMPS.radius.min, TUBE_CLAMPS.radius.max, TUBE_CLAMPS.radius.def),
	};
}


export function tubeAsRectSize(length, radius) {
	const s = sanitizeTubeSize(length, radius);
	return { width: s.length, height: 2 * s.radius };
}


export function tubeLightNits(brightness, length, radius) {
	const r = tubeAsRectSize(length, radius);
	return rectLightNits(brightness, r.width, r.height);
}


export function resolveAreaPartsFlag(raw, ctx) {
	if (ctx && ctx.weak === true) return false;
	if (raw === false) return false;
	if (raw === true) return true;
	return !!(ctx && ctx.realistic === true);
}


export function apClosestPointOnRect(p, c, right, up, hw, hh) {
	const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2];
	const s = clampf(dot3(dx, dy, dz, right[0], right[1], right[2]), -hw, hw);
	const t = clampf(dot3(dx, dy, dz, up[0], up[1], up[2]), -hh, hh);
	return [
		c[0] + right[0] * s + up[0] * t,
		c[1] + right[1] * s + up[1] * t,
		c[2] + right[2] * s + up[2] * t,
	];
}


export function apClosestPointOnSegment(p, c, axis, halfLen) {
	const t = clampf(
		dot3(p[0] - c[0], p[1] - c[1], p[2] - c[2], axis[0], axis[1], axis[2]),
		-halfLen,
		halfLen,
	);
	return [c[0] + axis[0] * t, c[1] + axis[1] * t, c[2] + axis[2] * t];
}


export function apWindowFalloff(dist, range) {
	const q = dist / Math.max(range, 0.05);
	const q2 = q * q;
	let w = 1 - q2 * q2;
	if (w < 0) w = 0;
	else if (w > 1) w = 1;
	return w * w;
}


export function apDiffuseAt(p, n, opts) {
	const kind = opts.kind === 1 ? 1 : 0;
	const cp = kind === 0
		? apClosestPointOnRect(p, opts.c, opts.right, opts.up, opts.halfW, opts.halfH)
		: apClosestPointOnSegment(p, opts.c, opts.right, opts.halfW);
	let lx = cp[0] - p[0], ly = cp[1] - p[1], lz = cp[2] - p[2];
	const d2 = lx * lx + ly * ly + lz * lz;
	const d = Math.sqrt(d2);
	const inv = 1 / Math.max(d, 1e-4);
	lx *= inv; ly *= inv; lz *= inv;
	const ndl = Math.max(dot3(n[0], n[1], n[2], lx, ly, lz), 0);
	const facing = kind === 0
		? Math.max(dot3(-lx, -ly, -lz, opts.normal[0], opts.normal[1], opts.normal[2]), 0)
		: 1;
	const win = apWindowFalloff(d, opts.range);
	const att = (opts.intensity * win) / Math.max(d2, 0.01);
	return { factor: att * ndl * facing, dist: d, ndl, facing, win };
}


export function apSpecPointOnRect(p, reflDir, c, right, up, normal, hw, hh) {
	const den = dot3(normal[0], normal[1], normal[2], reflDir[0], reflDir[1], reflDir[2]);
	let hx = p[0], hy = p[1], hz = p[2];
	if (Math.abs(den) > 1e-4) {
		const tHit = Math.max(
			dot3(c[0] - p[0], c[1] - p[1], c[2] - p[2], normal[0], normal[1], normal[2]) / den,
			0,
		);
		hx = p[0] + reflDir[0] * tHit;
		hy = p[1] + reflDir[1] * tHit;
		hz = p[2] + reflDir[2] * tHit;
	}
	const rx = hx - c[0], ry = hy - c[1], rz = hz - c[2];
	const s = clampf(dot3(rx, ry, rz, right[0], right[1], right[2]), -hw, hw);
	const t = clampf(dot3(rx, ry, rz, up[0], up[1], up[2]), -hh, hh);
	return [
		c[0] + right[0] * s + up[0] * t,
		c[1] + right[1] * s + up[1] * t,
		c[2] + right[2] * s + up[2] * t,
	];
}


export function apSpecPointOnTube(p, reflDir, c, axis, halfLen, radius) {
	const wx = c[0] - p[0], wy = c[1] - p[1], wz = c[2] - p[2];
	const b = dot3(axis[0], axis[1], axis[2], reflDir[0], reflDir[1], reflDir[2]);
	const cc = dot3(axis[0], axis[1], axis[2], wx, wy, wz);
	const f = dot3(reflDir[0], reflDir[1], reflDir[2], wx, wy, wz);
	const den = Math.max(1 - b * b, 1e-4);
	const tr = Math.max((f - b * cc) / den, 0);
	const rpx = p[0] + reflDir[0] * tr, rpy = p[1] + reflDir[1] * tr, rpz = p[2] + reflDir[2] * tr;
	const ta = clampf(
		dot3(rpx - c[0], rpy - c[1], rpz - c[2], axis[0], axis[1], axis[2]),
		-halfLen,
		halfLen,
	);
	const ax = c[0] + axis[0] * ta, ay = c[1] + axis[1] * ta, az = c[2] + axis[2] * ta;
	const tr2 = Math.max(dot3(ax - p[0], ay - p[1], az - p[2], reflDir[0], reflDir[1], reflDir[2]), 0);
	const qx = p[0] + reflDir[0] * tr2 - ax, qy = p[1] + reflDir[1] * tr2 - ay, qz = p[2] + reflDir[2] * tr2 - az;
	const tl = Math.sqrt(qx * qx + qy * qy + qz * qz);
	const k = Math.min(tl, radius) / Math.max(tl, 1e-4);
	return [ax + qx * k, ay + qy * k, az + qz * k];
}


export function apSpecEnergyNorm(shininess, srcRadius, dist) {
	const sh = Math.max(Number.isFinite(shininess) ? shininess : 30, 1e-4);
	const a = Math.sqrt(2 / (sh + 2));
	const r = Math.max(Number.isFinite(srcRadius) ? srcRadius : 0, 0);
	const d = Math.max(Number.isFinite(dist) ? dist : 0, 1e-4);
	const ap = Math.min(a + r / (2 * d), 1);
	const k2 = a / Math.max(ap, 1e-4);
	return Math.min(k2 * k2, 1);
}


export function packAreaPartsFrame(lights, out) {
	const n = Math.min(Array.isArray(lights) ? lights.length : 0, AP_MAX_LIGHTS);
	let count = 0;
	for (let i = 0; i < AP_MAX_LIGHTS; i++) {
		const o = i * 4;
		const L = i < n ? lights[i] : null;
		if (!L) {
			for (let k = 0; k < 4; k++) {
				out.pos[o + k] = 0; out.right[o + k] = 0; out.up[o + k] = 0;
				out.color[o + k] = 0; out.misc[o + k] = 0;
			}
			continue;
		}
		const f = (v) => (Number.isFinite(v) ? v : 0);
		out.pos[o] = f(L.x); out.pos[o + 1] = f(L.y); out.pos[o + 2] = f(L.z);
		out.pos[o + 3] = L.kind === 1 ? 1 : 0;
		out.right[o] = f(L.rx); out.right[o + 1] = f(L.ry); out.right[o + 2] = f(L.rz);
		out.right[o + 3] = Math.max(f(L.halfW), 0);
		out.up[o] = f(L.ux); out.up[o + 1] = f(L.uy); out.up[o + 2] = f(L.uz);
		out.up[o + 3] = Math.max(f(L.halfH), 0);
		out.color[o] = Math.max(f(L.r), 0); out.color[o + 1] = Math.max(f(L.g), 0);
		out.color[o + 2] = Math.max(f(L.b), 0); out.color[o + 3] = Math.max(f(L.intensity), 0);
		out.misc[o] = f(L.nx); out.misc[o + 1] = f(L.ny); out.misc[o + 2] = f(L.nz);
		out.misc[o + 3] = Math.max(f(L.range), 0);
		count++;
	}
	return count;
}


export const AP_PARS_ANCHOR = "#include <lights_pars_begin>";
export const AP_CODE_ANCHOR = "#include <lights_fragment_end>";

export const AP_CODE_SIG = "#if defined( RE_IndirectDiffuse )";
export const AP_MARKER = "uRswApOn";

export function buildAreaPartsParsGlsl() {
	const N = String(AP_MAX_LIGHTS);
	return [
		"// IL-F37: área lights (rect/tubo) nos pools Phong — uniform-driven.",
		"uniform float uRswApOn;",
		"uniform float uRswApCount;",
		"uniform vec4 uRswApPos[" + N + "];",
		"uniform vec4 uRswApRight[" + N + "];",
		"uniform vec4 uRswApUp[" + N + "];",
		"uniform vec4 uRswApColor[" + N + "];",
		"uniform vec4 uRswApMisc[" + N + "];",
		"float rswApWindow( const in float dist, const in float range ) {",
		"\tfloat q = dist / max( range, 0.05 );",
		"\tfloat q2 = q * q;",
		"\tfloat w = clamp( 1.0 - q2 * q2, 0.0, 1.0 );",
		"\treturn w * w;",
		"}",
		"vec3 rswApClosestRect( const in vec3 p, const in vec3 c, const in vec3 r, const in vec3 u, const in float hw, const in float hh ) {",
		"\tvec3 d = p - c;",
		"\tfloat s = clamp( dot( d, r ), -hw, hw );",
		"\tfloat t = clamp( dot( d, u ), -hh, hh );",
		"\treturn c + r * s + u * t;",
		"}",
		"",
	].join("\n");
}

export function buildAreaPartsCodeGlsl() {
	const N = String(AP_MAX_LIGHTS);
	return [
		"\t// IL-F37: área lights (rect/tubo) direto no Blinn-Phong dos pools —",
		"\t// MRP/LTC-lite (uRswApOn = 0.0 => ramo morto, byte a byte).",
		"\tif ( uRswApOn > 0.5 ) {",
		"\t\tfor ( int rswApI = 0; rswApI < " + N + "; rswApI ++ ) {",
		"\t\t\tif ( float( rswApI ) >= uRswApCount ) break;",
		"\t\t\tvec3 rswApC = ( viewMatrix * vec4( uRswApPos[ rswApI ].xyz, 1.0 ) ).xyz;",
		"\t\t\tfloat rswApKind = uRswApPos[ rswApI ].w;",
		"\t\t\tvec3 rswApR = normalize( mat3( viewMatrix ) * uRswApRight[ rswApI ].xyz );",
		"\t\t\tfloat rswApHw = uRswApRight[ rswApI ].w;",
		"\t\t\tvec3 rswApU = normalize( mat3( viewMatrix ) * uRswApUp[ rswApI ].xyz );",
		"\t\t\tfloat rswApHh = uRswApUp[ rswApI ].w;",
		"\t\t\tvec3 rswApN = normalize( mat3( viewMatrix ) * uRswApMisc[ rswApI ].xyz );",
		"\t\t\tfloat rswApRange = uRswApMisc[ rswApI ].w;",
		"\t\t\tvec3 rswApTint = uRswApColor[ rswApI ].rgb;",
		"\t\t\tfloat rswApInt = uRswApColor[ rswApI ].w;",
		"\t\t\tvec3 rswApDp = rswApKind < 0.5",
		"\t\t\t\t? rswApClosestRect( geometryPosition, rswApC, rswApR, rswApU, rswApHw, rswApHh )",
		"\t\t\t\t: rswApC + rswApR * clamp( dot( geometryPosition - rswApC, rswApR ), -rswApHw, rswApHw );",
		"\t\t\tvec3 rswApDv = rswApDp - geometryPosition;",
		"\t\t\tfloat rswApDd = length( rswApDv );",
		"\t\t\trswApDv /= max( rswApDd, 1e-4 );",
		"\t\t\tfloat rswApNdl = saturate( dot( geometryNormal, rswApDv ) );",
		"\t\t\tfloat rswApFace = rswApKind < 0.5 ? saturate( dot( -rswApDv, rswApN ) ) : 1.0;",
		"\t\t\tfloat rswApAtt = rswApInt * rswApWindow( rswApDd, rswApRange ) / max( rswApDd * rswApDd, 0.01 );",
		"\t\t\tvec3 rswApIrr = rswApTint * ( rswApAtt * rswApNdl * rswApFace );",
		"\t\t\treflectedLight.directDiffuse += rswApIrr * BRDF_Lambert( material.diffuseColor );",
		"\t\t\tvec3 rswApRef = reflect( - geometryViewDir, geometryNormal );",
		"\t\t\tvec3 rswApSp;",
		"\t\t\tif ( rswApKind < 0.5 ) {",
		"\t\t\t\tfloat rswApDen = dot( rswApN, rswApRef );",
		"\t\t\t\tvec3 rswApHit = abs( rswApDen ) > 1e-4",
		"\t\t\t\t\t? geometryPosition + rswApRef * max( dot( rswApC - geometryPosition, rswApN ) / rswApDen, 0.0 )",
		"\t\t\t\t\t: geometryPosition;",
		"\t\t\t\tvec3 rswApRel = rswApHit - rswApC;",
		"\t\t\t\trswApSp = rswApC + rswApR * clamp( dot( rswApRel, rswApR ), -rswApHw, rswApHw ) + rswApU * clamp( dot( rswApRel, rswApU ), -rswApHh, rswApHh );",
		"\t\t\t} else {",
		"\t\t\t\tvec3 rswApW = rswApC - geometryPosition;",
		"\t\t\t\tfloat rswApB = dot( rswApR, rswApRef );",
		"\t\t\t\tfloat rswApCc = dot( rswApR, rswApW );",
		"\t\t\t\tfloat rswApF = dot( rswApRef, rswApW );",
		"\t\t\t\tfloat rswApDen2 = max( 1.0 - rswApB * rswApB, 1e-4 );",
		"\t\t\t\tfloat rswApTr = max( ( rswApF - rswApB * rswApCc ) / rswApDen2, 0.0 );",
		"\t\t\t\tvec3 rswApRayPt = geometryPosition + rswApRef * rswApTr;",
		"\t\t\t\tfloat rswApTa = clamp( dot( rswApRayPt - rswApC, rswApR ), -rswApHw, rswApHw );",
		"\t\t\t\tvec3 rswApAx = rswApC + rswApR * rswApTa;",
		"\t\t\t\tfloat rswApTr2 = max( dot( rswApAx - geometryPosition, rswApRef ), 0.0 );",
		"\t\t\t\tvec3 rswApToRay = geometryPosition + rswApRef * rswApTr2 - rswApAx;",
		"\t\t\t\tfloat rswApTl = length( rswApToRay );",
		"\t\t\t\trswApSp = rswApAx + rswApToRay / max( rswApTl, 1e-4 ) * min( rswApTl, rswApHh );",
		"\t\t\t}",
		"\t\t\tvec3 rswApSv = rswApSp - geometryPosition;",
		"\t\t\tfloat rswApSd = length( rswApSv );",
		"\t\t\trswApSv /= max( rswApSd, 1e-4 );",
		"\t\t\tfloat rswApSface = rswApKind < 0.5 ? ( dot( - rswApSv, rswApN ) > 1e-4 ? 1.0 : 0.0 ) : 1.0;",
		"\t\t\tfloat rswApSatt = rswApInt * rswApWindow( rswApSd, rswApRange ) / max( rswApSd * rswApSd, 0.01 );",
		"\t\t\tfloat rswApSndl = saturate( dot( geometryNormal, rswApSv ) );",
		"\t\t\t// IL-F47 (c): normalização de energia do MRP (Karis) — espelho JS",
		"\t\t\t// em apSpecEnergyNorm (mesma conta, mesmos epsilons).",
		"\t\t\tfloat rswApAlpha = sqrt( 2.0 / ( max( material.specularShininess, 1e-4 ) + 2.0 ) );",
		"\t\t\tfloat rswApSrcR = rswApKind < 0.5 ? ( rswApHw + rswApHh ) * 0.5 : rswApHh;",
		"\t\t\tfloat rswApAlphaP = min( rswApAlpha + rswApSrcR / ( 2.0 * max( rswApSd, 1e-4 ) ), 1.0 );",
		"\t\t\tfloat rswApEn = rswApAlpha / max( rswApAlphaP, 1e-4 );",
		"\t\t\trswApEn = min( rswApEn * rswApEn, 1.0 );",
		"\t\t\treflectedLight.directSpecular += rswApTint * ( rswApSatt * rswApSndl * rswApSface * rswApEn ) * BRDF_BlinnPhong( rswApSv, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;",
		"\t\t}",
		"\t}",
		"",
	].join("\n");
}






export function patchAreaPartsFragment(fragmentShader) {
	const text = String(fragmentShader == null ? "" : fragmentShader);
	if (text.indexOf(AP_MARKER) !== -1) return { ok: false, text };
	const pi = text.indexOf(AP_PARS_ANCHOR);
	if (pi === -1) return { ok: false, text };
	let out = text.slice(0, pi) + buildAreaPartsParsGlsl() + "\n" + text.slice(pi);
	let ci = out.indexOf(AP_CODE_ANCHOR);
	if (ci === -1) ci = out.indexOf(AP_CODE_SIG);
	if (ci === -1) return { ok: false, text };
	out = out.slice(0, ci) + buildAreaPartsCodeGlsl() + "\n" + out.slice(ci);
	return { ok: true, text: out };
}
