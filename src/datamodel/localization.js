export const LOC_LIMITS = Object.freeze({ maxEntries: 10000, maxLocales: 50, maxText: 10000 });

export const COMMON_LOCALES = Object.freeze([
  { id: "en-us", name: "English (United States)" },
  { id: "pt-br", name: "Portugu\u00eas (Brasil)" },
  { id: "es", name: "Espa\u00f1ol" },
  { id: "fr", name: "Fran\u00e7ais" },
  { id: "de", name: "Deutsch" },
  { id: "it", name: "Italiano" },
  { id: "ja", name: "\u65e5\u672c\u8a9e" },
  { id: "ko", name: "\ud55c\uad6d\uc5b4" },
  { id: "zh-cn", name: "\u4e2d\u6587 (\u7b80\u4f53)" },
  { id: "zh-tw", name: "\u4e2d\u6587 (\u7e41\u9ad4)" },
  { id: "ru", name: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439" },
  { id: "ar", name: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629" },
  { id: "tr", name: "T\u00fcrk\u00e7e" },
  { id: "pl", name: "Polski" },
  { id: "nl", name: "Nederlands" },
  { id: "sv", name: "Svenska" },
  { id: "da", name: "Dansk" },
  { id: "no", name: "Norsk" },
  { id: "fi", name: "Suomi" },
  { id: "th", name: "\u0e44\u0e17\u0e22" },
  { id: "vi", name: "Ti\u1ebfng Vi\u1ec7t" },
  { id: "id", name: "Bahasa Indonesia" },
]);

const REGION_BY_LANG = Object.freeze({
  en: "US", pt: "BR", es: "ES", fr: "FR", de: "DE", it: "IT", ja: "JP", ko: "KR",
  zh: "CN", ru: "RU", ar: "SA", tr: "TR", pl: "PL", nl: "NL", sv: "SE", da: "DK",
  no: "NO", fi: "FI", th: "TH", vi: "VN", id: "ID",
});

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const FORMAT_TYPES = new Set(["int", "number", "datetime", "translate", "fixed"]);
const TEXT_PROPS = Object.freeze({ TextLabel: "Text", TextButton: "Text", TextBox: "PlaceholderText" });
const SCRIPT_TEXT_RE = /\.(?:Text|PlaceholderText)\s*=\s*(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)')/g;

export function sanitizeText(value) {
  if (value == null) return "";
  let s = String(value).replace(CONTROL_CHARS_RE, "");
  if (s.length > LOC_LIMITS.maxText) s = s.slice(0, LOC_LIMITS.maxText);
  return s;
}

export function sanitizeLocaleId(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(s) ? s : "";
}

export function sanitizeContextPath(value) {
  return sanitizeText(value).trim().slice(0, 1000);
}

export function regionForLocale(localeId) {
  const id = sanitizeLocaleId(localeId);
  if (!id) return "US";
  const dash = id.indexOf("-");
  if (dash >= 0) {
    const suffix = id.slice(dash + 1);
    if (/^[a-z]{2}$/.test(suffix)) return suffix.toUpperCase();
  }
  const base = dash >= 0 ? id.slice(0, dash) : id;
  return REGION_BY_LANG[base] || "US";
}

export function localeName(localeId) {
  const found = COMMON_LOCALES.find((l) => l.id === localeId);
  return found ? found.name : localeId;
}

export function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const source = sanitizeText(raw.Source);
  if (!source) return null;
  const entry = {
    Key: sanitizeText(raw.Key),
    Source: source,
    Context: sanitizeContextPath(raw.Context),
    Example: sanitizeText(raw.Example),
    Values: {},
  };
  const values = raw.Values;
  if (values && typeof values === "object") {
    for (const k of Object.keys(values)) {
      const locale = sanitizeLocaleId(k);
      const text = sanitizeText(values[k]);
      if (locale && text) entry.Values[locale] = text;
    }
  }
  return entry;
}

export function entryId(entry) {
  return `${entry.Key}\u0001${entry.Source}\u0001${entry.Context}`;
}

export function emptyContents() {
  return { locales: [], entries: [] };
}

export function parseContents(text) {
  const out = emptyContents();
  if (!text || typeof text !== "string") return out;
  let raw = null;
  try { raw = JSON.parse(text); } catch (_) { return out; }
  if (!raw || typeof raw !== "object") return out;
  const seenLocales = new Set();
  for (const l of Array.isArray(raw.locales) ? raw.locales : []) {
    const id = sanitizeLocaleId(l && l.id);
    if (!id || seenLocales.has(id)) continue;
    seenLocales.add(id);
    out.locales.push({ id, name: sanitizeText(l && l.name).slice(0, 80) || localeName(id) });
    if (out.locales.length >= LOC_LIMITS.maxLocales) break;
  }
  const seen = new Set();
  for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
    const entry = normalizeEntry(e);
    if (!entry) continue;
    const id = entryId(entry);
    if (seen.has(id)) continue;
    seen.add(id);
    out.entries.push(entry);
    if (out.entries.length >= LOC_LIMITS.maxEntries) break;
  }
  return out;
}

export function serializeContents(data) {
  return JSON.stringify({ locales: data.locales || [], entries: data.entries || [] });
}

export function localesOf(data) {
  const ids = [];
  const seen = new Set();
  for (const l of data.locales || []) {
    if (!seen.has(l.id)) { seen.add(l.id); ids.push(l.id); }
  }
  for (const e of data.entries || []) {
    for (const id of Object.keys(e.Values)) {
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
  }
  return ids;
}

export function buildIndexes(data) {
  const byKey = new Map();
  const byExact = new Map();
  const bySource = new Map();
  for (const e of data.entries || []) {
    if (e.Key && !byKey.has(e.Key)) byKey.set(e.Key, e);
    const exact = `${e.Source}\u0001${e.Context}`;
    if (!byExact.has(exact)) byExact.set(exact, e);
    let list = bySource.get(e.Source);
    if (!list) { list = []; bySource.set(e.Source, list); }
    list.push(e);
  }
  return { byKey, byExact, bySource };
}

function contextScore(entryContext, path) {
  if (!entryContext) return 1;
  if (!path) return 0;
  if (entryContext === path) return 3;
  if (path.length > entryContext.length && path.endsWith(entryContext) && path[path.length - entryContext.length - 1] === ".") return 2;
  if (entryContext.length > path.length && entryContext.endsWith(path) && entryContext[entryContext.length - path.length - 1] === ".") return 2;
  return 0;
}

export function contextAppliesTo(entryContext, path) {
  return contextScore(entryContext, path) > 0;
}

export function findEntryForSource(indexes, source, path) {
  const exact = indexes.byExact.get(`${source}\u0001${path || ""}`);
  if (exact) return exact;
  const list = indexes.bySource.get(source);
  if (!list) return null;
  let best = null;
  let bestScore = 0;
  for (const e of list) {
    const score = contextScore(e.Context, path || "");
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return best;
}

const DATE_ONLY_ARGUMENT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;


function parseDatetimeArgument(value) {
  const text = String(value == null ? "" : value).trim();
  if (text === "") return new Date(NaN);
  if (DATE_ONLY_ARGUMENT_PATTERN.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  const epochSeconds = Number(text);
  if (isFinite(epochSeconds)) return new Date(epochSeconds * 1000);
  return new Date(text);
}

function formatArg(value, type, localeId, translate) {
  switch (type) {
    case "int": {
      const n = Number(value);
      if (!isFinite(n)) throw new Error('FormatByKey: valor num\u00e9rico inv\u00e1lido para par\u00e2metro "int"');
      return String(Math.trunc(n));
    }
    case "number": {
      const n = Number(value);
      if (!isFinite(n)) throw new Error('FormatByKey: valor num\u00e9rico inv\u00e1lido para par\u00e2metro "number"');
      return String(n);
    }
    case "datetime": {
      const date = parseDatetimeArgument(value);
      if (isNaN(date.getTime())) throw new Error('FormatByKey: valor de data inv\u00e1lido para par\u00e2metro "datetime"');
      try { return date.toLocaleString(localeId); } catch (_) { return date.toISOString(); }
    }
    case "fixed": {


      const n = Number(value);
      if (!isFinite(n)) throw new Error('FormatByKey: valor numerico invalido para parametro "fixed"');
      return n.toFixed(2);
    }
    case "translate": {
      const text = String(value == null ? "" : value);
      if (typeof translate === "function") {
        const translated = translate(text);
        if (translated != null) return String(translated);
      }
      return text;
    }
    default:
      return String(value == null ? "" : value);
  }
}

export function formatMessage(pattern, args, options) {
  const opts = options || {};
  const localeId = opts.localeId || "en-us";
  const src = String(pattern == null ? "" : pattern);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch !== "{") { out += ch; i++; continue; }
    const end = src.indexOf("}", i + 1);
    if (end < 0) { out += src.slice(i); break; }
    const token = src.slice(i + 1, end).trim();
    const colon = token.indexOf(":");
    const name = (colon >= 0 ? token.slice(0, colon) : token).trim();
    const type = colon >= 0 ? token.slice(colon + 1).trim().toLowerCase() : "";
    if (!name) throw new Error("FormatByKey: placeholder vazio na string de tradu\u00e7\u00e3o");
    if (type && !FORMAT_TYPES.has(type)) throw new Error(`FormatByKey: tipo de par\u00e2metro desconhecido "${type}"`);
    if (!args || !(name in args)) throw new Error(`FormatByKey: argumento "${name}" ausente`);
    out += formatArg(args[name], type, localeId, opts.translate);
    i = end + 1;
  }
  return out;
}

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvSerialize(data) {
  const locales = localesOf(data);
  const lines = [["Key", "Source", "Context", "Example", ...locales].map(csvEscape).join(",")];
  for (const e of data.entries || []) {
    const row = [e.Key, e.Source, e.Context, e.Example, ...locales.map((id) => e.Values[id] || "")];
    lines.push(row.map(csvEscape).join(","));
  }
  return lines.join("\r\n");
}

export function csvParseRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const pushCell = () => { row.push(cell); cell = ""; };
  const pushRow = () => {
    if (row.length > 1 || (row.length === 1 && row[0].trim() !== "")) rows.push(row);
    row = [];
  };
  const s = String(text == null ? "" : text).replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushCell();
      pushRow();
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  pushCell();
  pushRow();
  return rows;
}

export function csvToContents(text) {
  const warnings = [];
  const rows = csvParseRows(text);
  if (!rows.length) return { locales: [], entries: [], warnings: ["CSV vazio"] };
  const header = rows[0].map((h) => String(h || "").trim());
  const base = header.slice(0, 2).map((h) => h.toLowerCase());
  if (base[0] !== "key" || base[1] !== "source") {
    warnings.push('Cabe\u00e7alho inv\u00e1lido: esperado "Key,Source,Context,Example,[locales...]"');
    return { locales: [], entries: [], warnings };
  }


  if (header.length > 2 && header[2] && header[2].toLowerCase() !== "context") {
    warnings.push(`Coluna 3 deveria ser "Context" (veio "${header[2]}"); locales s\u00f3 s\u00e3o lidos da coluna 5 em diante`);
  }
  if (header.length > 3 && header[3] && header[3].toLowerCase() !== "example") {
    warnings.push(`Coluna 4 deveria ser "Example" (veio "${header[3]}")`);
  }
  const localeCols = [];
  for (let c = 4; c < header.length; c++) {
    const id = sanitizeLocaleId(header[c]);
    if (!id) warnings.push(`Locale inv\u00e1lido no cabe\u00e7alho: "${header[c]}" (coluna ignorada)`);
    localeCols.push(id || null);
  }
  const entries = [];
  const seen = new Set();
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length < 2) {
      warnings.push(`Linha ${r + 1} malformada (ignorada)`);
      continue;
    }
    const values = {};
    for (let c = 0; c < localeCols.length; c++) {
      const id = localeCols[c];
      const value = cols[c + 4];
      if (id && value) values[id] = value;
    }
    const entry = normalizeEntry({ Key: cols[0], Source: cols[1], Context: cols[2], Example: cols[3], Values: values });
    if (!entry) {
      warnings.push(`Linha ${r + 1} sem Source (ignorada)`);
      continue;
    }
    const id = entryId(entry);
    if (seen.has(id)) {
      warnings.push(`Linha ${r + 1} duplicada (ignorada)`);
      continue;
    }
    seen.add(id);
    entries.push(entry);
    if (entries.length >= LOC_LIMITS.maxEntries) {
      warnings.push("Limite de entries atingido; linhas restantes ignoradas");
      break;
    }
  }
  const locales = [];
  for (const id of localeCols) {
    if (id && !locales.some((l) => l.id === id)) locales.push({ id, name: localeName(id) });
  }
  return { locales, entries, warnings };
}

export function instancePath(inst) {
  const parts = [];
  let cur = inst;
  let guard = 0;
  while (cur && guard++ < 100) {
    if (cur.className === "DataModel") {
      parts.unshift("game");
      break;
    }
    parts.unshift(sanitizeText(cur.name).slice(0, 100) || cur.className);
    cur = typeof cur.getParent === "function" ? cur.getParent() : null;
  }
  return parts.join(".").slice(0, 1000);
}

function walk(root, visit) {
  const stack = [root];
  let guard = 0;
  while (stack.length && guard++ < 200000) {
    const cur = stack.pop();
    visit(cur);
    const children = typeof cur.getChildren === "function" ? cur.getChildren() : [];
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
}

export function findLocalizationTables(dataModel) {
  const out = [];
  if (!dataModel) return out;
  walk(dataModel, (inst) => {
    if (inst.className === "LocalizationTable") out.push(inst);
  });
  return out;
}

export function primaryLocalizationTable(dataModel) {
  const tables = findLocalizationTables(dataModel);
  if (!tables.length) return null;
  const serviceChild = tables.find((t) => {
    const parent = typeof t.getParent === "function" ? t.getParent() : null;
    return parent && parent.className === "LocalizationService";
  });
  return serviceChild || tables[0];
}

export function collectGuiTexts(root, rootContext) {
  const out = [];
  const stack = [[root, rootContext]];
  let guard = 0;
  while (stack.length && guard++ < 200000) {
    const [inst, path] = stack.pop();
    const propName = TEXT_PROPS[inst.className];
    if (propName && typeof inst.hasProperty === "function" && inst.hasProperty(propName)) {
      const text = sanitizeText(inst.getProperty(propName));
      if (text.trim()) out.push({ instance: inst, property: propName, text, context: path });
    }
    const children = typeof inst.getChildren === "function" ? inst.getChildren() : [];
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      stack.push([child, `${path}.${sanitizeText(child.name).slice(0, 100) || child.className}`]);
    }
  }
  return out;
}

function unescapeLuaString(s) {
  return s.replace(/\\(n|t|r|\\|"|')/g, (_m, c) => {
    if (c === "n") return "\n";
    if (c === "t") return "\t";
    if (c === "r") return "\r";
    return c;
  });
}

export function captureStrings(dataModel) {
  const found = [];
  if (dataModel) {
    const starterGui = dataModel.getChildren().find((c) => c.className === "StarterGui");
    if (starterGui) {
      for (const child of starterGui.getChildren()) {
        const rootContext = `game.StarterGui.${sanitizeText(child.name).slice(0, 100) || child.className}`;
        for (const t of collectGuiTexts(child, rootContext)) {
          found.push({ Key: "", Source: t.text, Context: t.context, Example: "", Values: {} });
        }
      }
    }
    walk(dataModel, (inst) => {
      if (inst.className !== "Script" && inst.className !== "LocalScript") return;
      if (typeof inst.hasProperty !== "function" || !inst.hasProperty("Source")) return;
      const source = String(inst.getProperty("Source") || "");
      const context = instancePath(inst);
      SCRIPT_TEXT_RE.lastIndex = 0;
      let match;
      let guard = 0;
      while ((match = SCRIPT_TEXT_RE.exec(source)) && guard++ < 2000) {
        const text = sanitizeText(unescapeLuaString(match[1] != null ? match[1] : match[2]));
        if (text.trim()) found.push({ Key: "", Source: text, Context: context, Example: "", Values: {} });
      }
    });
  }
  const seen = new Set();
  const out = [];
  for (const raw of found) {
    const entry = normalizeEntry(raw);
    if (!entry) continue;
    const id = entryId(entry);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(entry);
    if (out.length >= LOC_LIMITS.maxEntries) break;
  }
  return out;
}
