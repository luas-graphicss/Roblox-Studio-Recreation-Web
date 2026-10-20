import { read, write } from "../utils/storage.js";
import { bus } from "../core/eventBus.js";

import { registerFrameCallback } from "../core/frameDriver.js";

const TOUR_KEY = "tourCompleted";

const STEPS = [
  {
    title: "Start Page",
    text: "Welcome! Start by choosing a template or opening a project. You can return here anytime via File > Close Place.",
    target: ".rsw-start",
  },
  {
    title: "3D Viewport",
    text: "This is your 3D workspace. Navigate with right-click drag and scroll to zoom.",
    target: ".rsw-viewport",
  },
  {
    title: "Explorer",
    text: "The Explorer shows all objects in your game, organized as a tree.",
    target: '.rsw-dock--explorer',
  },
  {
    title: "Properties",
    text: "Select an object to view and edit its properties here.",
    target: '.rsw-dock--properties',
  },
  {
    title: "Ribbon / Toolbar",
    text: "Use the toolbar to access tools for building, scripting and testing.",
    target: ".rsw-ribbon",
  },
  {
    title: "Toolbox",
    text: "Find free models, images and audio in the Toolbox (View > Toolbox).",
    target: ".rsw-toolbox",
  },
  {
    title: "Script Editor",
    text: "Double-click a script in Explorer to open the code editor with full Luau IntelliSense.",
    target: ".rsw-center",
  },
  {
    title: "Play Button",
    text: "Press F5 to test your game. Press Shift+F5 to stop.",
    target: ".rsw-ribbon",
  },
  {
    title: "Output",
    text: "Check the Output panel for errors and debug messages from your scripts.",
    target: '.rsw-dock--output',
  },
  {
    title: "Save Your Work",
    text: "Don't forget to save! Press Ctrl+S or use File > Save.",
    target: ".rsw-menubar",
  },
];

let _layer = null;
let _spot = null;
let _tip = null;
let _index = 0;
let _raf = 0;
let unregisterTrackFrameCallback = null;
let _lastSig = "";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function isTourCompleted() {
  return read(TOUR_KEY) === "1";
}

function findTarget(step) {
  if (!step.target) return null;
  const node = document.querySelector(step.target);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") return null;
  return r;
}


function rectSignature() {
  const rect = findTarget(STEPS[_index]);
  const r = rect
    ? Math.round(rect.left) + "," + Math.round(rect.top) + "," + Math.round(rect.width) + "," + Math.round(rect.height)
    : "none";
  return r + "|" + window.innerWidth + "x" + window.innerHeight + "|" + _index;
}


function trackLoop() {
  if (!_layer) return;
  if (rectSignature() !== _lastSig) positionForStep();
}

function positionForStep() {
  if (!_layer) return;
  const step = STEPS[_index];
  const rect = findTarget(step);
  if (rect) {
    _spot.style.display = "";


    const spotLeft = Math.max(0, rect.left - 4);
    const spotTop = Math.max(0, rect.top - 4);
    const spotRight = Math.min(window.innerWidth, rect.right + 4);
    const spotBottom = Math.min(window.innerHeight, rect.bottom + 4);
    _spot.style.left = spotLeft + "px";
    _spot.style.top = spotTop + "px";
    _spot.style.width = Math.max(0, spotRight - spotLeft) + "px";
    _spot.style.height = Math.max(0, spotBottom - spotTop) + "px";
    _layer.classList.remove("rsw-tour--dim");
  } else {
    _spot.style.display = "none";
    _layer.classList.add("rsw-tour--dim");
  }

  const tw = _tip.offsetWidth || 320;
  const th = _tip.offsetHeight || 150;
  let left;
  let top;
  if (rect) {
    left = Math.round(rect.left + rect.width / 2 - tw / 2);
    top = Math.round(rect.bottom + 12);
    if (top + th > window.innerHeight - 8) top = Math.round(rect.top - th - 12);
    if (top < 8) top = Math.round(window.innerHeight / 2 - th / 2);
  } else {
    left = Math.round(window.innerWidth / 2 - tw / 2);
    top = Math.round(window.innerHeight / 2 - th / 2);
  }
  left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
  top = Math.max(8, Math.min(window.innerHeight - th - 8, top));
  _tip.style.left = left + "px";
  _tip.style.top = top + "px";
  _lastSig = rectSignature();
}

function onResize() {
  if (_raf) return;
  _raf = requestAnimationFrame(() => {
    _raf = 0;
    positionForStep();
  });
}

function onTourKey(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    endTour(false);
    return;
  }
  if (!_tip) return;


  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "ArrowRight") {
      if (_index === STEPS.length - 1) {
        endTour(true);
      } else {
        _index += 1;
        renderStep();
      }
    } else if (_index > 0) {
      _index -= 1;
      renderStep();
    }
    return;
  }
  if (e.key === "Tab") {


    e.stopPropagation();
    const btns = Array.from(_tip.querySelectorAll("button")).filter((b) => !b.disabled);
    if (!btns.length) return;
    const first = btns[0];
    const last = btns[btns.length - 1];
    const active = document.activeElement;
    if (!_tip.contains(active)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  }
}

function renderStep() {
  const step = STEPS[_index];
  _tip.replaceChildren();
  _tip.appendChild(el("div", "rsw-tour__tiptitle", step.title));
  _tip.appendChild(el("div", "rsw-tour__tiptext", step.text));
  const foot = el("div", "rsw-tour__tipfoot");
  foot.appendChild(el("span", "rsw-tour__progress", "Step " + (_index + 1) + " of " + STEPS.length));
  const btns = el("div", "rsw-tour__btns");
  const skip = el("button", "rsw-tour__btn", "Skip Tour");
  skip.type = "button";
  skip.addEventListener("click", () => endTour(false));
  const back = el("button", "rsw-tour__btn", "Back");
  back.type = "button";
  back.disabled = _index === 0;
  back.addEventListener("click", () => {
    if (_index > 0) {
      _index -= 1;
      renderStep();
    }
  });
  const last = _index === STEPS.length - 1;
  const next = el("button", "rsw-tour__btn rsw-tour__btn--primary", last ? "Finish" : "Next");
  next.type = "button";
  next.addEventListener("click", () => {
    if (last) endTour(true);
    else {
      _index += 1;
      renderStep();
    }
  });
  btns.append(skip, back, next);
  foot.appendChild(btns);
  _tip.appendChild(foot);
  positionForStep();
  next.focus();
}

function endTour(completed) {
  if (_raf) {
    cancelAnimationFrame(_raf);
    _raf = 0;
  }
  if (unregisterTrackFrameCallback) {
    unregisterTrackFrameCallback();
    unregisterTrackFrameCallback = null;
  }
  if (_layer && _layer.parentNode) _layer.parentNode.removeChild(_layer);
  _layer = null;
  _spot = null;
  _tip = null;
  window.removeEventListener("resize", onResize);
  window.removeEventListener("keydown", onTourKey, true);
  write(TOUR_KEY, "1");
  bus.emit("tour:completed", { completed: !!completed });
}

export function startWelcomeTour() {
  if (_layer) return;
  _index = 0;
  _layer = el("div", "rsw-tour");
  _layer.setAttribute("role", "dialog");
  _layer.setAttribute("aria-modal", "true");
  _layer.setAttribute("aria-label", "Welcome Tour");
  _spot = el("div", "rsw-tour__spot");
  _tip = el("div", "rsw-tour__tip");
  _layer.append(_spot, _tip);
  document.body.appendChild(_layer);
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onTourKey, true);
  renderStep();
  unregisterTrackFrameCallback = registerFrameCallback("overlay", trackLoop, "welcomeTour:targetTracker");
}
