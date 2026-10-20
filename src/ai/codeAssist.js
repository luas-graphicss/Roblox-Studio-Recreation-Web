import { settings } from "../config/settings.js";
import { bus } from "../core/eventBus.js";
import { aiClient } from "./aiClient.js";
import { isAIConfigured } from "./aiConfig.js";

const DEBOUNCE_MS = 400;
const CACHE_LIMIT = 60;
const PREFIX_CHARS = 3000;
const SUFFIX_CHARS = 1000;
const ERROR_RESET_MS = 4000;

const COMPLETION_PROMPT = [
  "You are a Luau code completion engine inside Roblox Studio Web.",
  "Continue the code exactly at the <CURSOR> marker.",
  "Return ONLY the raw continuation text, with no code fences, no explanations and no repetition of the code before the cursor.",
  "Match the existing indentation, quote style and naming conventions.",
  "Only use Roblox API members that really exist.",
  "If the cursor follows a comment describing an intent, implement that intent completely.",
  "Keep the completion short unless a full implementation is clearly requested by a comment.",
].join("\n");

let registered = false;
let status = "idle";
let errorTimer = null;
let activeController = null;
let requestSeq = 0;
const cache = new Map();

function setStatus(next) {
  if (status === next) {


    if (next === "error") {
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(() => setStatus("idle"), ERROR_RESET_MS);
    }
    return;
  }



  if (errorTimer) {
    clearTimeout(errorTimer);
    errorTimer = null;
  }
  status = next;
  bus.emit("codeAssist:status", { state: status });
  if (next === "error") {
    errorTimer = setTimeout(() => setStatus("idle"), ERROR_RESET_MS);
  }
}

export function getCodeAssistStatus() {
  return status;
}

export function isCodeAssistEnabled() {
  return settings.get("editorCodeAssist") === true && isAIConfigured();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


export function cacheKey(model, position, prefix, suffix) {
  return model.uri.toString() + ":" + position.lineNumber + ":" + position.column + ":" + prefix.slice(-200) + ":" + String(suffix || "").slice(0, 200);
}

function cacheGet(key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  cache.set(key, value);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
}

function cleanSuggestion(raw, lineBeforeCursor) {
  let text = String(raw || "");
  text = text.replace(/^\s*```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
  text = text.replace(/\s+$/, "");
  const trimmedLine = lineBeforeCursor.trimStart();
  if (trimmedLine && text.startsWith(lineBeforeCursor)) text = text.slice(lineBeforeCursor.length);
  else if (trimmedLine && text.startsWith(trimmedLine)) text = text.slice(trimmedLine.length);
  return text;
}

function intentComment(model, position) {
  if (position.lineNumber <= 1) return false;
  const prev = String(model.getLineContent(position.lineNumber - 1) || "").trim();
  const current = String(model.getLineContent(position.lineNumber) || "").trim();
  return prev.startsWith("--") && current.length === 0;
}

async function requestSuggestion(model, position, scriptMeta, forced, token) {
  const seq = ++requestSeq;


  const settleStatus = () => {
    if (seq === requestSeq && status === "requesting") setStatus("idle");
  };
  if (!forced) {
    await sleep(DEBOUNCE_MS);
    if (token.isCancellationRequested || seq !== requestSeq) {
      settleStatus();
      return null;
    }
  }
  const fullRange = model.getFullModelRange();
  const prefix = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  }).slice(-PREFIX_CHARS);
  const suffix = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: position.column,
    endLineNumber: fullRange.endLineNumber,
    endColumn: fullRange.endColumn,
  }).slice(0, SUFFIX_CHARS);
  if (!forced && !prefix.trim()) {
    settleStatus();
    return null;
  }
  const key = cacheKey(model, position, prefix, suffix);
  const cached = cacheGet(key);
  if (cached !== null) {
    settleStatus();
    return cached;
  }


  if (!forced && aiClient.rateLimitRemaining() < 2) {
    settleStatus();
    return null;
  }
  if (activeController) activeController.abort();
  const controller = new AbortController();
  activeController = controller;
  if (typeof token.onCancellationRequested === "function") token.onCancellationRequested(() => controller.abort());
  const meta = scriptMeta || {};
  const wantsImplementation = intentComment(model, position);
  const userContent = [
    "Script: " + (meta.name || "Script") + " (" + (meta.className || "Script") + ")",
    meta.path ? "Path: " + meta.path : "",
    meta.projectSummary ? "Project: " + meta.projectSummary : "",
    "Code:",
    prefix + "<CURSOR>" + suffix,
  ].filter(Boolean).join("\n");
  setStatus("requesting");
  try {
    const raw = await aiClient.completeOnce(
      [
        { role: "system", content: COMPLETION_PROMPT },
        { role: "user", content: userContent },
      ],
      { signal: controller.signal, maxTokens: wantsImplementation ? 400 : 160 },
    );
    const lineBefore = prefix.slice(prefix.lastIndexOf("\n") + 1);
    const text = cleanSuggestion(raw, lineBefore);


    cacheSet(key, text || "");
    if (seq !== requestSeq) return null;
    setStatus("idle");
    return text || null;
  } catch (e) {
    if (e && e.name === "AbortError") {
      if (seq === requestSeq) setStatus("idle");
      return null;
    }
    if (e && (e.code === "rateLimit" || e.code === "disabled" || e.code === "config")) {
      if (seq === requestSeq) setStatus("idle");
      return null;
    }


    if (seq === requestSeq) setStatus("error");
    return null;
  } finally {
    if (activeController === controller) activeController = null;
  }
}

export function registerCodeAssist(monaco, languageId, getScriptMeta) {
  if (registered || !monaco || !monaco.languages || typeof monaco.languages.registerInlineCompletionsProvider !== "function") return;
  registered = true;
  monaco.languages.registerInlineCompletionsProvider(languageId, {
    provideInlineCompletions: async (model, position, context, token) => {
      try {
        if (!isCodeAssistEnabled()) return { items: [] };
        const forced = context && context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit;
        const meta = typeof getScriptMeta === "function" ? getScriptMeta(model) : null;
        const text = await requestSuggestion(model, position, meta, forced, token);
        if (!text || token.isCancellationRequested) return { items: [] };
        return { items: [{ insertText: text }] };
      } catch (_) {
        return { items: [] };
      }
    },
    freeInlineCompletions() {},
  });
}
