const FLOAT_LAYER_MIN = 7000;                           
const FLOAT_LAYER_MAX = 8400;                                    


const FLOATING_WINDOW_SELECTOR = [
  ".rsw-pwidget",
  ".rsw-dwidget--float",
  ".rsw-devcon",
  ".rsw-avatar-panel",
  ".rsw-val",
  ".rsw-wn",
  ".rsw-mp",
  ".rsw-stats",
  ".rsw-tasks",
  ".rsw-dsv",
].join(", ");

let topLayer = FLOAT_LAYER_MIN;
let isPointerListenerAttached = false;


export function raiseWindow(el) {
  if (!el) return;
  if (topLayer + 1 > FLOAT_LAYER_MAX) {


    renormalizeLayers();
  }
  topLayer += 1;
  el.style.zIndex = String(topLayer);
}


export function startSharedWindowStack() {
  if (isPointerListenerAttached) return;
  isPointerListenerAttached = true;
  document.addEventListener("pointerdown", onPointerDown, true);
}

function onPointerDown(event) {
  const target = event.target;
  if (!target || typeof target.closest !== "function") return;
  const floatingWindow = target.closest(FLOATING_WINDOW_SELECTOR);
  if (floatingWindow) raiseWindow(floatingWindow);
}

function renormalizeLayers() {
  const floatingWindows = Array.from(
    document.querySelectorAll(FLOATING_WINDOW_SELECTOR)
  );

  floatingWindows.sort((a, b) => currentLayerOf(a) - currentLayerOf(b));
  topLayer = FLOAT_LAYER_MIN;
  for (const floatingWindow of floatingWindows) {
    topLayer += 1;
    floatingWindow.style.zIndex = String(topLayer);
  }
}

function currentLayerOf(el) {
  return parseInt(el.style.zIndex, 10) || FLOAT_LAYER_MIN;
}
