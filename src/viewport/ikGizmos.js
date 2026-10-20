import { store } from "../core/state.js";
import { ikWorldPosOf, buildBoneChain } from "../animation/ikRuntime.js";

const SCAN_MS = 600;
const COLOR_OK = 0x35c26e;
const COLOR_OUT = 0xd64545;
const COLOR_CHAIN = 0xf5d34c;
const COLOR_POLE = 0xe8a33d;

function live(inst) {
  return !!(
    inst &&
    inst.__isInstance === true &&
    !(typeof inst.isDestroyed === "function" && inst.isDestroyed())
  );
}

function getVec(inst, prop) {
  let v = null;
  try {
    v = inst.getProperty(prop);
  } catch (_) {
    v = null;
  }
  v = v || {};
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}

export function initIkGizmos({ THREE, scene, requestRender }) {
  const group = new THREE.Group();
  group.name = "__rswIkGizmos";
  group.renderOrder = 999;
  scene.add(group);

  const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
  const pool = [];                                                              
  let scanAt = 0;
  let controls = [];
  let disposed = false;

  function makeEntry() {
    const lineMat = new THREE.LineDashedMaterial({
      color: COLOR_OK,
      dashSize: 0.35,
      gapSize: 0.2,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const line = new THREE.Line(new THREE.BufferGeometry(), lineMat);
    line.renderOrder = 999;
    line.frustumCulled = false;
    const targetMat = new THREE.MeshBasicMaterial({ color: COLOR_OK, depthTest: false, transparent: true, opacity: 0.9 });
    const targetSph = new THREE.Mesh(sphereGeo, targetMat);
    targetSph.scale.setScalar(0.14);
    targetSph.renderOrder = 999;
    const poleMat = new THREE.MeshBasicMaterial({ color: COLOR_POLE, depthTest: false, transparent: true, opacity: 0.9 });
    const poleSph = new THREE.Mesh(sphereGeo, poleMat);
    poleSph.scale.setScalar(0.09);
    poleSph.renderOrder = 999;
    const chainMat = new THREE.LineBasicMaterial({ color: COLOR_CHAIN, transparent: true, opacity: 0.95, depthTest: false });
    const chainLine = new THREE.Line(new THREE.BufferGeometry(), chainMat);
    chainLine.renderOrder = 999;
    chainLine.frustumCulled = false;
    group.add(line, targetSph, poleSph, chainLine);
    const entry = { line, lineMat, targetSph, targetMat, poleSph, chainLine };
    pool.push(entry);
    return entry;
  }

  function hideEntry(e) {
    e.line.visible = false;
    e.targetSph.visible = false;
    e.poleSph.visible = false;
    e.chainLine.visible = false;
  }

  function rescan() {
    const dm = store.getDataModel ? store.getDataModel() : null;
    const ws = dm && dm.findFirstChild ? dm.findFirstChild("Workspace") : null;
    if (!ws || typeof ws.getDescendants !== "function") {
      controls = [];
      return;
    }
    controls = ws.getDescendants().filter((d) => {
      if (d.className !== "IKControl") return false;
      const p = d.getParent ? d.getParent() : null;
      return !!(p && (p.className === "Humanoid" || p.className === "Animator"));
    });
  }

  function chainPointsFor(ctl, effPos) {
    const built = buildBoneChain(ctl);
    if (built && built.chain) {
      const pts = [];
      for (const b of built.chain) {
        const wp = ikWorldPosOf(b);
        if (wp) pts.push(wp);
      }
      if (pts.length >= 2) return pts;
    }
    const root = ctl.getProperty("ChainRoot");
    const rp = live(root) ? ikWorldPosOf(root) : null;
    if (rp && effPos) return [rp, effPos];
    return null;
  }

  function update() {
    if (disposed) return;
    const show = store.getViewOption ? store.getViewOption("showGizmos") !== false : true;
    const now = Date.now();
    if (now - scanAt > SCAN_MS) {
      scanAt = now;
      if (show) rescan();
    }
    if (!show || !controls.length) {
      let any = false;
      for (const e of pool) {
        if (e.line.visible) any = true;
        hideEntry(e);
      }
      group.visible = false;
      if (any && requestRender) requestRender();
      return;
    }
    group.visible = true;

    let used = 0;
    for (const ctl of controls) {
      if (!live(ctl) || ctl.getProperty("Enabled") === false) continue;
      const eff = ctl.getProperty("EndEffector");
      const target = ctl.getProperty("Target");
      if (!live(eff) || !live(target)) continue;
      const effPos = ikWorldPosOf(eff);
      const tpBase = ikWorldPosOf(target);
      if (!effPos || !tpBase) continue;
      const off = getVec(ctl, "Offset");
      const tp = { x: tpBase.x + off.x, y: tpBase.y + off.y, z: tpBase.z + off.z };

      const entry = pool[used] || makeEntry();
      used += 1;

      const chainPts = chainPointsFor(ctl, effPos);
      let reachable = true;
      if (chainPts && chainPts.length >= 2) {
        let total = 0;
        for (let i = 1; i < chainPts.length; i += 1) {
          total += Math.hypot(
            chainPts[i].x - chainPts[i - 1].x,
            chainPts[i].y - chainPts[i - 1].y,
            chainPts[i].z - chainPts[i - 1].z,
          );
        }
        const rootPt = chainPts[0];
        const dist = Math.hypot(tp.x - rootPt.x, tp.y - rootPt.y, tp.z - rootPt.z);
        reachable = dist <= total + 0.05;
        entry.chainLine.geometry.setFromPoints(chainPts.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
        entry.chainLine.visible = true;
      } else {

        const dist = Math.hypot(tp.x - effPos.x, tp.y - effPos.y, tp.z - effPos.z);
        reachable = dist <= 6;
        entry.chainLine.visible = false;
      }

      const color = reachable ? COLOR_OK : COLOR_OUT;
      entry.lineMat.color.setHex(color);
      entry.targetMat.color.setHex(color);
      entry.line.geometry.setFromPoints([
        new THREE.Vector3(effPos.x, effPos.y, effPos.z),
        new THREE.Vector3(tp.x, tp.y, tp.z),
      ]);
      entry.line.computeLineDistances();
      entry.line.visible = true;
      entry.targetSph.position.set(tp.x, tp.y, tp.z);
      entry.targetSph.visible = true;

      const pole = ctl.getProperty("Pole");
      const pp = live(pole) ? ikWorldPosOf(pole) : null;
      if (pp) {
        entry.poleSph.position.set(pp.x, pp.y, pp.z);
        entry.poleSph.visible = true;
      } else {
        entry.poleSph.visible = false;
      }
    }
    for (let i = used; i < pool.length; i += 1) hideEntry(pool[i]);
  }

  function dispose() {
    disposed = true;
    for (const e of pool) {
      e.line.geometry.dispose();
      e.lineMat.dispose();
      e.chainLine.geometry.dispose();
      e.chainLine.material.dispose();
      e.targetMat.dispose();
      e.poleSph.material.dispose();
    }
    pool.length = 0;
    sphereGeo.dispose();
    if (group.parent) group.parent.remove(group);
  }

  return { update, dispose };
}
