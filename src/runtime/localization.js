import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import {
  buildIndexes,
  collectGuiTexts,
  findEntryForSource,
  findLocalizationTables,
  localesOf,
  parseContents,
  sanitizeLocaleId,
  sanitizeText,
} from "../datamodel/localization.js";

const MAX_MISSING_WARNINGS = 30;

let testLocale = "en-us";
let originals = new WeakMap();
let warnedMissing = new Set();

export function detectSystemLocale() {
  try {
    const nav = globalThis.navigator;
    const lang = nav && nav.language ? String(nav.language).toLowerCase() : "";
    return sanitizeLocaleId(lang) || "en-us";
  } catch (_) {
    return "en-us";
  }
}

export function getTestLocale() {
  return testLocale;
}

export function setTestLocale(localeId) {
  const id = sanitizeLocaleId(localeId);
  if (!id || id === testLocale) return false;
  testLocale = id;
  try {
    syncServiceLocales(typeof store.getDataModel === "function" ? store.getDataModel() : null);
  } catch (_) {            }
  bus.emit("localization:testLocaleChanged", { localeId: id });
  return true;
}

export function syncServiceLocales(dataModel) {
  if (!dataModel || typeof dataModel.getChildren !== "function") return;
  const service = dataModel.getChildren().find((c) => c.className === "LocalizationService");
  if (!service || typeof service._setInternal !== "function") return;
  try {
    service._setInternal("RobloxLocaleId", testLocale);
    service._setInternal("SystemLocaleId", detectSystemLocale());
  } catch (_) {            }
}

export function availableLocales(dataModel) {
  const ids = ["en-us"];
  const seen = new Set(ids);
  if (dataModel) {
    for (const table of findLocalizationTables(dataModel)) {
      const source = sanitizeLocaleId(table.getProperty("SourceLocaleId"));
      if (source && !seen.has(source)) { seen.add(source); ids.push(source); }
      for (const id of localesOf(parseContents(table.getProperty("Contents")))) {
        if (!seen.has(id)) { seen.add(id); ids.push(id); }
      }
    }
  }
  if (!seen.has(testLocale)) ids.push(testLocale);
  return ids;
}

export function resetPlaytestState() {
  originals = new WeakMap();
  warnedMissing = new Set();
}

function loadTables(dataModel) {
  return findLocalizationTables(dataModel).map((inst) => {
    const data = parseContents(inst.getProperty("Contents"));
    return {
      inst,
      data,
      indexes: buildIndexes(data),
      sourceLocale: sanitizeLocaleId(inst.getProperty("SourceLocaleId")) || "en-us",
    };
  });
}

function warnMissing(logger, localeId, source) {
  if (!logger || typeof logger.warn !== "function") return;
  if (warnedMissing.size >= MAX_MISSING_WARNINGS) return;
  const key = `${localeId}\u0001${source}`;
  if (warnedMissing.has(key)) return;
  warnedMissing.add(key);
  logger.warn(
    `Localization: sem tradu\u00e7\u00e3o "${localeId}" para "${source.slice(0, 80)}"`,
    { source: "Localization" },
  );
}

function lookupTranslation(tables, localeId, source, context, logger) {
  for (const t of tables) {
    const entry = findEntryForSource(t.indexes, source, context);
    if (!entry) continue;
    if (localeId === t.sourceLocale) return { text: source };
    const value = entry.Values[localeId];
    if (value) return { text: value };
    warnMissing(logger, localeId, source);
  }
  return null;
}

function applyTranslation(item, tables, localeId, logger) {
  const inst = item.instance;
  let record = originals.get(inst);
  if (!record) {
    record = { props: {} };
    originals.set(inst, record);
  }
  let slot = record.props[item.property];
  if (!slot) {
    slot = { original: item.text, applied: null };
    record.props[item.property] = slot;
  }
  const hit = lookupTranslation(tables, localeId, slot.original, item.context, logger);
  const next = hit ? hit.text : slot.original;
  const current = sanitizeText(inst.getProperty(item.property));
  if (next === current) {
    slot.applied = next;
    return;
  }
  try {
    inst.setProperty(item.property, next);
    slot.applied = next;
  } catch (_) {            }
}

function rootContextFor(root) {
  return `game.StarterGui.${sanitizeText(root.name).slice(0, 100) || root.className}`;
}

export function autoTranslateGuiRoots(dataModel, roots, logger) {
  if (!dataModel || !roots || !roots.length) return;
  const tables = loadTables(dataModel);
  if (!tables.length) return;
  for (const root of roots) {
    bus.emit("localization:autoTranslateWillRun", { gui: root });
    for (const item of collectGuiTexts(root, rootContextFor(root))) {
      applyTranslation(item, tables, testLocale, logger);
    }
  }
}

export function reapplyTranslations(dataModel, playerGui, logger) {
  if (!dataModel || !playerGui) return;
  const tables = loadTables(dataModel);
  if (!tables.length) return;
  for (const root of playerGui.getChildren()) {
    if (
      typeof root.hasProperty === "function" &&
      root.hasProperty("Enabled") &&
      root.getProperty("Enabled") === false
    ) continue;
    for (const item of collectGuiTexts(root, rootContextFor(root))) {
      const record = originals.get(item.instance);
      const slot = record && record.props[item.property];
      if (slot && slot.applied != null && slot.applied !== item.text) continue;
      applyTranslation(item, tables, testLocale, logger);
    }
  }
}
