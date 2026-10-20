import { runCooperativeWork } from "../boot/cooperativeWork.js";

const DEFERRED_STYLE_ATTRIBUTE = "data-deferred-style";
const DEFERRED_STYLE_SELECTOR = 'link[rel="stylesheet"][' + DEFERRED_STYLE_ATTRIBUTE + ']';
const ACTIVE_MEDIA = "all";

let deferredStylesActivated = false;

function activateStylesheet(stylesheetLink) {
  if (stylesheetLink.media === ACTIVE_MEDIA) return false;
  stylesheetLink.media = ACTIVE_MEDIA;
  return true;
}


export function activateDeferredStyles(targetDocument = globalThis.document) {
  if (deferredStylesActivated) return 0;
  if (!targetDocument || typeof targetDocument.querySelectorAll !== "function") return 0;
  deferredStylesActivated = true;
  let activatedCount = 0;
  for (const stylesheetLink of targetDocument.querySelectorAll(DEFERRED_STYLE_SELECTOR)) {
    if (activateStylesheet(stylesheetLink)) activatedCount++;
  }
  return activatedCount;
}


export async function activateDeferredStylesCooperatively(targetDocument = globalThis.document, context = {}) {
  if (deferredStylesActivated || !targetDocument?.querySelectorAll) return 0;
  const links = Array.from(targetDocument.querySelectorAll(DEFERRED_STYLE_SELECTOR));
  let activatedCount = 0;
  function* activateLinks() {
    for (let index = 0; index < links.length; index++) {
      if (activateStylesheet(links[index])) activatedCount++;
      yield (index + 1) / links.length;
    }
  }
  await runCooperativeWork(activateLinks(), { ...context, maxStepsPerSlice: 1 });
  deferredStylesActivated = true;
  return activatedCount;
}


export function resetDeferredStylesForTests() {
  deferredStylesActivated = false;
}
