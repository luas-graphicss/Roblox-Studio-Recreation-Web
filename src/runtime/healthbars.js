import { getProjection } from "../viewport/projection.js";

const LOD_DIST = 50;                                        
const MAX_DRAW_DIST = 400;

let container = null;
let host = null;
const els = new Map();                                           
let frame = 0;

function ensureContainer() {
  const proj = getProjection();
  if (!proj || !proj.container) return null;
  if (container && host === proj.container && container.parentNode === host) return container;
  destroyContainer();
  host = proj.container;
  try {
    const cs = window.getComputedStyle(host);
    if (cs && cs.position === "static") host.style.position = "relative";
  } catch (_) {                                 }
  container = document.createElement("div");
  container.className = "rsw-healthbars";
  container.style.cssText =
    "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:30;";
  host.appendChild(container);
  return container;
}

function destroyContainer() {
  if (container && container.parentNode) container.parentNode.removeChild(container);
  container = null;
  host = null;
  els.clear();
}

function makeEl(key) {
  const root = document.createElement("div");
  root.style.cssText =
    "position:absolute;left:0;top:0;transform:translate(-50%,-100%);" +
    "display:flex;flex-direction:column;align-items:center;gap:2px;" +
    "pointer-events:none;will-change:transform;";
  const label = document.createElement("div");
  label.style.cssText =
    "color:#fff;font:600 12px system-ui,sans-serif;text-shadow:0 1px 2px rgba(0,0,0,.85);" +
    "white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;";
  const barBg = document.createElement("div");
  barBg.style.cssText =
    "width:58px;height:6px;border-radius:3px;background:rgba(0,0,0,.55);" +
    "border:1px solid rgba(0,0,0,.6);overflow:hidden;";
  const fill = document.createElement("div");
  fill.style.cssText = "height:100%;width:100%;background:#3fc154;border-radius:2px;";
  barBg.appendChild(fill);
  root.appendChild(label);
  root.appendChild(barBg);
  const rec = { root, fill, label, barBg, lastFrame: -1 };
  els.set(key, rec);
  return rec;
}

export const healthbars = {
  start() {
    frame = 0;
  },

  stop() {
    destroyContainer();
  },



  update(items) {
    frame += 1;
    const proj = getProjection();
    const cont = proj ? ensureContainer() : null;
    if (!cont) {
      if (container) destroyContainer();
      return;
    }
    const seen = new Set();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const p = proj.project(it.x, it.y, it.z);
      const rec = els.get(it.key) || makeEl(it.key);
      if (rec.root.parentNode !== cont) cont.appendChild(rec.root);
      seen.add(it.key);

      if (!p || !p.visible || p.dist > MAX_DRAW_DIST) {
        rec.root.style.display = "none";
        continue;
      }
      const showBar = it.showBar && p.dist <= (it.healthDist > 0 ? it.healthDist : Infinity);
      const showLabel = it.showLabel && it.label && p.dist <= (it.nameDist > 0 ? it.nameDist : Infinity);
      if (!showBar && !showLabel) {
        rec.root.style.display = "none";
        continue;
      }
      rec.root.style.display = "flex";
      rec.barBg.style.display = showBar ? "block" : "none";
      rec.label.style.display = showLabel ? "block" : "none";


      const skip = p.dist > LOD_DIST && rec.lastFrame >= 0 && frame - rec.lastFrame < 4;
      if (!skip) {
        rec.lastFrame = frame;
        rec.root.style.transform =
          "translate(" + Math.round(p.x) + "px," + Math.round(p.y) + "px) translate(-50%,-100%)";
        if (showLabel && rec.label.textContent !== it.label) rec.label.textContent = it.label;
        if (showBar) {
          const max = it.maxHealth > 0 ? it.maxHealth : 1;
          const pct = Math.max(0, Math.min(1, it.health / max));
          rec.fill.style.width = (pct * 100).toFixed(1) + "%";
          rec.fill.style.background = pct > 0.5 ? "#3fc154" : pct > 0.25 ? "#e6b830" : "#e0452f";
        }
      }
    }

    for (const [key, rec] of els) {
      if (!seen.has(key)) {
        if (rec.root.parentNode) rec.root.parentNode.removeChild(rec.root);
        els.delete(key);
      }
    }
  },
};
