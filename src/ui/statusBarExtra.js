import { bus } from "../core/eventBus.js";
import { settings } from "../config/settings.js";
import { selection } from "../core/selection.js";
import { engine } from "../runtime/engine.js";
import { createIcon } from "./icons.js";
import { toggleNotificationCenter, registerNotificationBadge } from "./notificationCenter.js";
import { startVisibilityAwareInterval } from "../core/visibilityAwareInterval.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtCoord(v) {
  return Number.isFinite(v) ? String(Math.trunc(v * 10) / 10) : "0";
}

function readVec(v) {
  if (!v || typeof v !== "object") return null;
  const x = Number(v.x != null ? v.x : v.X);
  const y = Number(v.y != null ? v.y : v.Y);
  const z = Number(v.z != null ? v.z : v.Z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function selectedPosition() {
  try {
    const sel = selection.get();
    if (!sel || !sel.length) return null;
    const first = sel[0];
    if (!first || typeof first.getProperty !== "function") return null;
    return readVec(first.getProperty("Position"));
  } catch (_) {
    return null;
  }
}


let _popup = null;
let _popupAnchor = null;
function closePopup() {
  if (_popup && _popup.parentNode) _popup.parentNode.removeChild(_popup);
  _popup = null;
  _popupAnchor = null;
  document.removeEventListener("mousedown", onPopupDocDown, true);
}
function onPopupDocDown(e) {
  if (!_popup || _popup.contains(e.target)) return;
  if (_popupAnchor && _popupAnchor.contains(e.target)) return;
  closePopup();
}
function openQuickMenu(anchor, title, options, isActive, onPick) {
  if (_popup) {
    const sameAnchor = _popupAnchor === anchor;
    closePopup();
    if (sameAnchor) return;
  }
  const pop = el("div", "rsw-sbpop");
  pop.appendChild(el("div", "rsw-sbpop__title", title));
  for (const opt of options) {
    const btn = el("button", "rsw-sbpop__opt" + (isActive(opt) ? " is-active" : ""), opt.label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      onPick(opt);
      closePopup();
    });
    pop.appendChild(btn);
  }
  const r = anchor.getBoundingClientRect();
  document.body.appendChild(pop);
  pop.style.left = Math.max(4, Math.min(window.innerWidth - pop.offsetWidth - 4, Math.round(r.left))) + "px";
  pop.style.top = Math.round(r.top - pop.offsetHeight - 6) + "px";
  _popup = pop;
  _popupAnchor = anchor;
  document.addEventListener("mousedown", onPopupDocDown, true);
}


const STATUS_REFRESH_INTERVAL_MS = 500;
let stopStatusRefreshInterval = null;


export function disposeStatusBarExtra() {
  if (!stopStatusRefreshInterval) return;
  stopStatusRefreshInterval();
  stopStatusRefreshInterval = null;
}

export function initStatusBarExtra(refs) {
  if (!refs || !refs.leftSeg || !refs.centerSeg || !refs.rightSeg) return;


  const spinner = el("span", "rsw-sb__spinner is-hidden");
  spinner.title = "Working\u2026";
  refs.leftSeg.appendChild(spinner);
  bus.on("status:message", (p) => {
    const text = p && p.text ? String(p.text) : "";
    const busy = /(\u2026|\.\.\.)\s*$/.test(text);
    spinner.classList.toggle("is-hidden", !busy);
  });


  const modeChip = el("span", "rsw-sb__chip rsw-sb__mode", "Edit Mode");
  modeChip.title = "Current Studio mode";
  const latChip = el("span", "rsw-sb__chip rsw-sb__lat rsw-sb-lowpri is-hidden", "");
  latChip.title = "Simulated network latency";
  refs.centerSeg.append(modeChip, latChip);


  const coordsChip = el("span", "rsw-sb__chip rsw-sb__coords rsw-sb-lowpri is-hidden", "");
  coordsChip.title = "Position of the selected object (X, Y, Z)";
  const selChip = el("span", "rsw-sb__chip rsw-sb__selcount rsw-sb-midpri is-hidden", "");
  selChip.title = "Selected objects";

  const gridChip = el("button", "rsw-sb__chip rsw-sb__btnchip", "Grid: \u2014");
  gridChip.type = "button";
  gridChip.title = "Move snap \u2014 click to change";
  const rotChip = el("button", "rsw-sb__chip rsw-sb__btnchip", "Rotate: \u2014");
  rotChip.type = "button";
  rotChip.title = "Rotate snap \u2014 click to change";

  const asChip = el("button", "rsw-sb__chip rsw-sb__btnchip rsw-sb-midpri", "Auto-Save");
  asChip.type = "button";
  asChip.title = "Auto-Save \u2014 click to open settings";

  const bellBtn = el("button", "rsw-sb__bell");
  bellBtn.type = "button";
  bellBtn.title = "Notifications";
  bellBtn.appendChild(createIcon("bell", 13));
  const bellBadge = el("span", "rsw-badge is-hidden", "0");
  bellBtn.appendChild(bellBadge);
  registerNotificationBadge(bellBadge);
  bellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleNotificationCenter(bellBtn);
  });

  refs.rightSeg.prepend(coordsChip, selChip, gridChip, rotChip, asChip, bellBtn);


  const gridOptions = [
    { label: "Off", value: 0 },
    { label: "0.25 studs", value: 0.25 },
    { label: "0.5 studs", value: 0.5 },
    { label: "1 stud", value: 1 },
    { label: "2 studs", value: 2 },
    { label: "4 studs", value: 4 },
  ];
  gridChip.addEventListener("click", () => {
    openQuickMenu(gridChip, "Grid Snap", gridOptions, (opt) => {
      const enabled = settings.get("moveSnapEnabled") !== false;
      const cur = Number(settings.get("moveSnap"));
      return opt.value === 0 ? !enabled : enabled && cur === opt.value;
    }, (opt) => {
      if (opt.value === 0) settings.set("moveSnapEnabled", false);
      else {
        settings.set("moveSnapEnabled", true);
        settings.set("moveSnap", opt.value);
      }
      updateSnaps();
    });
  });
  const rotOptions = [
    { label: "Off", value: 0 },
    { label: "15\u00b0", value: 15 },
    { label: "30\u00b0", value: 30 },
    { label: "45\u00b0", value: 45 },
    { label: "90\u00b0", value: 90 },
  ];
  rotChip.addEventListener("click", () => {
    openQuickMenu(rotChip, "Rotate Snap", rotOptions, (opt) => {
      const enabled = settings.get("rotateSnapEnabled") !== false;
      const cur = Number(settings.get("rotateSnap"));
      return opt.value === 0 ? !enabled : enabled && cur === opt.value;
    }, (opt) => {
      if (opt.value === 0) settings.set("rotateSnapEnabled", false);
      else {
        settings.set("rotateSnapEnabled", true);
        settings.set("rotateSnap", opt.value);
      }
      updateSnaps();
    });
  });

  asChip.addEventListener("click", () => {
    import("./dialogs/studioSettings.js")
      .then((m) => m.openStudioSettings())
      .catch(() => {});
  });

  function updateSnaps() {
    const moveOn = settings.get("moveSnapEnabled") !== false;
    const rotOn = settings.get("rotateSnapEnabled") !== false;
    let move = Number(settings.get("moveSnap"));
    if (!Number.isFinite(move) || move <= 0) move = 1;
    let rot = Number(settings.get("rotateSnap"));
    if (!Number.isFinite(rot) || rot <= 0) rot = 45;
    gridChip.textContent = moveOn ? "Grid: " + move + (move === 1 ? " stud" : " studs") : "Grid: Off";
    rotChip.textContent = rotOn ? "Rotate: " + rot + "\u00b0" : "Rotate: Off";
  }
  bus.on("settings:changed", (p) => {
    if (p && typeof p.key === "string" && /Snap/.test(p.key)) updateSnaps();
  });
  bus.on("settings:reset", updateSnaps);
  updateSnaps();


  let latency = 35;


  function refreshStatusBar() {

    let mode = "Edit Mode";
    let running = false;
    try {
      running = engine.isRunning();
      if (running) {
        const pstate = typeof engine.getPlaytestState === "function" ? engine.getPlaytestState() : null;
        const view = pstate && typeof pstate === "object" ? pstate.view || pstate.mode : null;
        mode = view && /server/i.test(String(view)) ? "Playtest Mode (Server)" : "Playtest Mode (Client 1)";
      }
    } catch (_) {
      mode = "Edit Mode";
    }
    modeChip.textContent = mode;
    modeChip.classList.toggle("is-playtest", running);


    if (running) {
      latency = Math.max(18, Math.min(120, latency + (Math.random() - 0.5) * 8));
      latChip.textContent = Math.round(latency) + " ms";
      latChip.classList.remove("is-hidden");
    } else {
      latChip.classList.add("is-hidden");
    }


    let count = 0;
    try {
      const sel = selection.get();
      count = sel ? sel.length : 0;
    } catch (_) {
      count = 0;
    }
    if (count > 0) {
      selChip.textContent = count === 1 ? "1 object selected" : count + " objects selected";
      selChip.classList.remove("is-hidden");
    } else {
      selChip.classList.add("is-hidden");
    }
    const pos = selectedPosition();
    if (pos) {
      coordsChip.textContent = fmtCoord(pos.x) + ", " + fmtCoord(pos.y) + ", " + fmtCoord(pos.z);
      coordsChip.classList.remove("is-hidden");
    } else {
      coordsChip.classList.add("is-hidden");
    }


    if (settings.get("autosave") === false) {
      asChip.textContent = "Auto-Save: Off";
    } else {
      let intervalMin = Number(settings.get("autosaveIntervalMin"));
      if (!Number.isFinite(intervalMin)) intervalMin = 5;
      intervalMin = Math.min(60, Math.max(1, intervalMin));
      asChip.textContent = "Auto-Save: " + intervalMin + " min";
    }
  }

  disposeStatusBarExtra();
  refreshStatusBar();
  stopStatusRefreshInterval = startVisibilityAwareInterval(
    refreshStatusBar,
    STATUS_REFRESH_INTERVAL_MS,
  );
}
