function clamp(v, min, max) {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

function normalize3(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

export function createCameraRig(opts = {}) {
  const MIN_R = Number.isFinite(opts.minRadius) ? opts.minRadius : 2;
  const MAX_R = Number.isFinite(opts.maxRadius) ? opts.maxRadius : 8000;
  const MIN_PHI = 0.05;
  const MAX_PHI = Math.PI - 0.05;
  const ROT_SPEED = 0.0052;
  const ZOOM_SPEED = 0.0016;
  const PAN_SPEED = 0.0016;


  const target = { x: 0, y: 0, z: 0 };
  let radius = Number.isFinite(opts.radius) ? clamp(opts.radius, MIN_R, MAX_R) : 64;
  let theta = Math.PI / 4;                  
  let phi = 0.94;                               

  function getOffset() {
    const sinPhi = Math.sin(phi);
    return {
      x: radius * sinPhi * Math.sin(theta),
      y: radius * Math.cos(phi),
      z: radius * sinPhi * Math.cos(theta),
    };
  }

  function getPosition() {
    const o = getOffset();
    return { x: target.x + o.x, y: target.y + o.y, z: target.z + o.z };
  }

  function getTarget() {
    return { x: target.x, y: target.y, z: target.z };
  }


  function basis() {
    const o = getOffset();
    const forward = normalize3(-o.x, -o.y, -o.z);                         

    const right = normalize3(-forward.z, 0, forward.x);

    const up = normalize3(
      right.y * forward.z - right.z * forward.y,
      right.z * forward.x - right.x * forward.z,
      right.x * forward.y - right.y * forward.x,
    );
    return { forward, right, up };
  }


  function orbit(dx, dy) {
    if (!Number.isFinite(dx)) dx = 0;
    if (!Number.isFinite(dy)) dy = 0;
    theta -= dx * ROT_SPEED;

    const TWO_PI = Math.PI * 2;
    theta = ((theta % TWO_PI) + TWO_PI) % TWO_PI;
    phi = clamp(phi - dy * ROT_SPEED, MIN_PHI, MAX_PHI);
  }


  function pan(dx, dy) {
    if (!Number.isFinite(dx)) dx = 0;
    if (!Number.isFinite(dy)) dy = 0;
    const { right, up } = basis();
    const scale = PAN_SPEED * radius;
    target.x += (-right.x * dx + up.x * dy) * scale;
    target.y += (-right.y * dx + up.y * dy) * scale;
    target.z += (-right.z * dx + up.z * dy) * scale;
  }


  function moveLocal(forwardAmt, rightAmt, upAmt) {
    const { forward, right } = basis();
    const fa = Number.isFinite(forwardAmt) ? forwardAmt : 0;
    const ra = Number.isFinite(rightAmt) ? rightAmt : 0;
    const ua = Number.isFinite(upAmt) ? upAmt : 0;
    target.x += forward.x * fa + right.x * ra;
    target.y += forward.y * fa + right.y * ra + ua;                        
    target.z += forward.z * fa + right.z * ra;
  }


  function zoom(deltaY) {
    if (!Number.isFinite(deltaY)) return;
    radius = clamp(radius * Math.exp(deltaY * ZOOM_SPEED), MIN_R, MAX_R);
  }


  function retarget(point) {
    if (!point) return;
    if (Number.isFinite(point.x)) target.x = point.x;
    if (Number.isFinite(point.y)) target.y = point.y;
    if (Number.isFinite(point.z)) target.z = point.z;
  }


  function focus(point, newRadius) {
    retarget(point);
    if (Number.isFinite(newRadius)) radius = clamp(newRadius, MIN_R, MAX_R);
  }


  function frame(items, pad = 1.5) {
    if (!Array.isArray(items) || items.length === 0) return;
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    let any = false;
    for (const it of items) {
      const p = it && it.position ? it.position : it;


      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
      const s = it && it.size ? it.size : { x: 0, y: 0, z: 0 };
      const hx = Math.abs(Number.isFinite(s.x) ? s.x : 0) / 2;
      const hy = Math.abs(Number.isFinite(s.y) ? s.y : 0) / 2;
      const hz = Math.abs(Number.isFinite(s.z) ? s.z : 0) / 2;
      minx = Math.min(minx, p.x - hx); maxx = Math.max(maxx, p.x + hx);
      miny = Math.min(miny, p.y - hy); maxy = Math.max(maxy, p.y + hy);
      minz = Math.min(minz, p.z - hz); maxz = Math.max(maxz, p.z + hz);
      any = true;
    }
    if (!any) return;
    target.x = (minx + maxx) / 2;
    target.y = (miny + maxy) / 2;
    target.z = (minz + maxz) / 2;
    const diag = Math.hypot(maxx - minx, maxy - miny, maxz - minz);
    radius = clamp(Math.max(diag * pad, MIN_R * 2), MIN_R, MAX_R);
  }

  function getState() {
    return {
      target: { x: target.x, y: target.y, z: target.z },
      radius,
      theta,
      phi,
    };
  }

  function reset() {
    target.x = 0; target.y = 0; target.z = 0;
    radius = 64; theta = Math.PI / 4; phi = 0.94;
  }


  function setPose(position, direction, newRadius) {
    if (!position || !direction || !Number.isFinite(position.x)) {
      reset();
      return;
    }
    const d = normalize3(
      Number.isFinite(direction.x) ? direction.x : 0,
      Number.isFinite(direction.y) ? direction.y : 0,
      Number.isFinite(direction.z) ? direction.z : 1,
    );
    radius = clamp(Number.isFinite(newRadius) ? newRadius : radius, MIN_R, MAX_R);
    target.x = position.x + d.x * radius;
    target.y = (Number.isFinite(position.y) ? position.y : 0) + d.y * radius;
    target.z = (Number.isFinite(position.z) ? position.z : 0) + d.z * radius;
    phi = clamp(Math.acos(clamp(-d.y, -1, 1)), MIN_PHI, MAX_PHI);
    const TWO_PI = Math.PI * 2;
    theta = ((Math.atan2(-d.x, -d.z) % TWO_PI) + TWO_PI) % TWO_PI;
  }

  return {
    orbit,
    pan,
    moveLocal,
    zoom,
    retarget,
    focus,
    frame,
    getPosition,
    getTarget,
    getState,
    basis,
    reset,
    setPose,
    limits: { MIN_R, MAX_R, MIN_PHI, MAX_PHI },
  };
}
