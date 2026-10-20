import {
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  shouldBlockEditor,
} from "./viewportGateCore.js";

const GATE_TITLE = "Window too small";
const GATE_MESSAGE =
  "Roblox Studio Web needs a window of at least " +
  MIN_WINDOW_WIDTH +
  "x" +
  MIN_WINDOW_HEIGHT +
  " pixels. Resize the browser window to continue editing.";


const DISMISS_BUTTON_LABEL = "Continue anyway (layout may break)";

const TITLE_ELEMENT_ID = "rsw-viewport-gate-title";
const MESSAGE_ELEMENT_ID = "rsw-viewport-gate-message";


const BLOCKED_BY_GATE_ATTRIBUTE = "data-rsw-blocked-by-viewport-gate";

let gateElement = null;
let dismissButton = null;
let isGateVisible = false;


let dismissedWindowSize = null;


export function initViewportGate() {
  globalThis.addEventListener("resize", syncGateWithWindowSize);
  syncGateWithWindowSize();
}


function isEditorEmbedded() {
  try {
    return globalThis.self !== globalThis.top;
  } catch (_) {
    return true;
  }
}

function syncGateWithWindowSize() {
  const mustBlockEditor = shouldBlockEditor({
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
    isEmbedded: isEditorEmbedded(),
    dismissedSize: dismissedWindowSize,
  });
  if (mustBlockEditor) showGate();
  else hideGate();
}

function showGate() {
  if (isGateVisible) return;
  isGateVisible = true;
  if (!gateElement) gateElement = buildGateElement();
  document.body.appendChild(gateElement);
  blockAppBehindGate(true);
  dismissButton.focus();
}

function hideGate() {
  if (!isGateVisible) return;
  isGateVisible = false;
  if (gateElement) gateElement.remove();
  blockAppBehindGate(false);
}

function dismissGate() {
  dismissedWindowSize = {
    width: globalThis.innerWidth,
    height: globalThis.innerHeight,
  };
  hideGate();
}


function blockAppBehindGate(shouldBlock) {
  if (shouldBlock) {
    for (const sibling of Array.from(document.body.children)) {
      if (sibling === gateElement) continue;
      sibling.inert = true;
      sibling.setAttribute(BLOCKED_BY_GATE_ATTRIBUTE, "true");
    }
    return;
  }
  const blocked = document.body.querySelectorAll(
    "[" + BLOCKED_BY_GATE_ATTRIBUTE + "]"
  );
  for (const sibling of blocked) {
    sibling.inert = false;
    sibling.removeAttribute(BLOCKED_BY_GATE_ATTRIBUTE);
  }
}

function buildGateElement() {
  const gate = document.createElement("div");
  gate.className = "rsw-vgate";
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-modal", "true");
  gate.setAttribute("aria-labelledby", TITLE_ELEMENT_ID);
  gate.setAttribute("aria-describedby", MESSAGE_ELEMENT_ID);

  const title = document.createElement("h1");
  title.className = "rsw-vgate__title";
  title.id = TITLE_ELEMENT_ID;
  title.textContent = GATE_TITLE;                                          

  const message = document.createElement("p");
  message.className = "rsw-vgate__message";
  message.id = MESSAGE_ELEMENT_ID;
  message.textContent = GATE_MESSAGE;

  dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "rsw-vgate__dismiss";
  dismissButton.textContent = DISMISS_BUTTON_LABEL;
  dismissButton.addEventListener("click", dismissGate);

  gate.append(title, message, dismissButton);
  return gate;
}
