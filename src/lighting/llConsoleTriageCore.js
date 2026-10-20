export const CONSOLE_TRIAGE_VERDICT = Object.freeze({
  BLOCKS_LOCAL_LIGHTS: "blocks-local-lights",
  RELATED_TO_LOCAL_LIGHTS: "related-to-local-lights",
  UNRELATED: "unrelated",
});


export const LOCAL_LIGHT_CONSOLE_KEYWORDS = Object.freeze([
  "light",
  "luz",
  "shadow",
  "sombra",
  "shader",
  "glsl",
  "uniform",
  "webgl",
  "program",
  "compile",
  "material",
  "three",
  "texture",
  "attenuation",
  "falloff",
  "spot",
  "rect",
  "ies",
  "cookie",
  "atlas",
  "cluster",
  "megalights",
  "onbeforecompile",
]);

const BLOCKING_LEVELS = Object.freeze(["error", "fatal"]);

function normalizeText(value) {
  return String(value === undefined || value === null ? "" : value).toLowerCase();
}

export function matchedLocalLightKeywords(text) {
  const haystack = normalizeText(text);
  return LOCAL_LIGHT_CONSOLE_KEYWORDS.filter((keyword) => haystack.indexOf(keyword) >= 0);
}

export function classifyConsoleEntry(entry) {
  const level = normalizeText(entry && entry.level) || "log";
  const text = (entry && entry.text) || "";
  const matchedKeywords = matchedLocalLightKeywords(text);
  const isErrorLevel = BLOCKING_LEVELS.indexOf(level) >= 0;
  let verdict = CONSOLE_TRIAGE_VERDICT.UNRELATED;
  if (matchedKeywords.length > 0) {
    verdict = isErrorLevel
      ? CONSOLE_TRIAGE_VERDICT.BLOCKS_LOCAL_LIGHTS
      : CONSOLE_TRIAGE_VERDICT.RELATED_TO_LOCAL_LIGHTS;
  }
  return {
    level,
    source: (entry && entry.source) || "",
    text: String(text),
    at: (entry && entry.at) || null,
    matchedKeywords,
    verdict,
    blocking: verdict === CONSOLE_TRIAGE_VERDICT.BLOCKS_LOCAL_LIGHTS,
  };
}

export function triageConsoleEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const classified = list.map(classifyConsoleEntry);
  const counts = {
    "blocks-local-lights": 0,
    "related-to-local-lights": 0,
    unrelated: 0,
  };
  classified.forEach((item) => {
    counts[item.verdict] += 1;
  });
  const blocking = classified.filter((item) => item.blocking);
  return {
    total: classified.length,
    counts,
    blocking,
    entries: classified,
    clear: blocking.length === 0,
  };
}

export function isConsoleTriageClear(summary) {
  return !!summary && summary.clear === true;
}
