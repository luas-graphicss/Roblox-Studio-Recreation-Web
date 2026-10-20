import { settings } from "../config/settings.js";
import { read, remove } from "../utils/storage.js";
import { getSessionApiKey, setSessionApiKey, clearSessionApiKey } from "./apiKeyVault.js";
import { isAllowedAiEndpoint } from "./endpointPolicy.js";
import { bus } from "../core/eventBus.js";


const LEGACY_API_KEY_STORAGE_SLOT = "aiApiKey";

let legacyApiKeyMigrationDone = false;

function migrateLegacyApiKeyOnce() {
  if (legacyApiKeyMigrationDone) return;
  legacyApiKeyMigrationDone = true;
  const legacyApiKey = read(LEGACY_API_KEY_STORAGE_SLOT);
  if (legacyApiKey) setSessionApiKey(legacyApiKey);

  remove(LEGACY_API_KEY_STORAGE_SLOT);
}

export const AI_PROVIDERS = Object.freeze({
  openai: Object.freeze({
    id: "openai",
    label: "OpenAI API",
    endpoint: "https://api.openai.com/v1/chat/completions",
    wire: "openai",
    needsKey: true,
    models: Object.freeze(["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"]),
  }),
  anthropic: Object.freeze({
    id: "anthropic",
    label: "Anthropic Claude API",
    endpoint: "https://api.anthropic.com/v1/messages",
    wire: "anthropic",
    needsKey: true,
    models: Object.freeze(["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest", "claude-3-7-sonnet-latest"]),
  }),
  ollama: Object.freeze({
    id: "ollama",
    label: "Local (Ollama)",
    endpoint: "http://localhost:11434/api/chat",
    wire: "ollama",
    needsKey: false,
    models: Object.freeze(["llama3.1", "qwen2.5-coder", "codellama", "mistral"]),
  }),
  custom: Object.freeze({
    id: "custom",
    label: "Custom Endpoint",
    endpoint: "",
    wire: "openai",
    needsKey: false,
    models: Object.freeze(["default"]),
  }),
});

export const DEFAULT_AI_SYSTEM_PROMPT = [
  "You are the Roblox Studio Assistant embedded in Roblox Studio Web.",
  "You help creators build experiences, write Luau code and understand the Roblox API.",
  "Rules:",
  "- Always write code in Luau and wrap it in fenced blocks tagged luau.",
  "- Only reference Roblox API classes, methods, properties and services that really exist. Never invent API members.",
  "- Prefer short, direct answers focused on the user's question.",
  "- When asked to create or change objects in the place, reply with action blocks: fenced blocks tagged action, each containing a single JSON object.",
  '- Action JSON shapes: {"type":"createInstance","className":"Part","name":"RedPart","parentPath":"Workspace","properties":{"Anchored":true},"description":"Create a red Part in Workspace"} or {"type":"setProperty","targetPath":"Workspace.RedPart","property":"Transparency","value":0.5,"description":"Make the part translucent"} or {"type":"insertScript","scriptType":"Script","name":"Main","parentPath":"ServerScriptService","source":"print(1)","description":"Insert a Script"} or {"type":"deleteInstance","targetPath":"Workspace.OldPart","description":"Delete the old part"}.',
  "- parentPath and targetPath are dot separated instance paths starting at a top level service such as Workspace or ServerScriptService.",
  "- Never include API keys, secrets or personal data in answers.",
].join("\n");

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function providerInfo(id) {
  return AI_PROVIDERS[id] || AI_PROVIDERS.openai;
}

export function getApiKey() {
  migrateLegacyApiKeyOnce();
  return getSessionApiKey();
}

export function setApiKey(value) {
  migrateLegacyApiKeyOnce();
  const v = typeof value === "string" ? value.trim() : "";
  const prev = getSessionApiKey();
  if (v) setSessionApiKey(v);
  else clearSessionApiKey();
  if (v !== prev) bus.emit("settings:changed", { key: "aiApiKey", value: v ? "[set]" : "", prev: prev ? "[set]" : "" });
}

export function getAIConfig() {
  const provider = providerInfo(settings.get("aiProvider"));
  const endpointSetting = String(settings.get("aiEndpoint") || "").trim();
  let endpoint = provider.endpoint;
  if (provider.id === "custom") endpoint = endpointSetting;
  else if (provider.id === "ollama") endpoint = endpointSetting || provider.endpoint;


  if (endpoint && !isAllowedAiEndpoint(endpoint)) endpoint = "";
  const model = String(settings.get("aiModel") || "").trim() || provider.models[0] || "";
  return {
    enabled: settings.get("aiEnabled") === true,
    provider: provider.id,
    wire: provider.wire,
    endpoint,
    model,
    maxTokens: clampInt(settings.get("aiMaxTokens"), 64, 8192, 1024),
    temperature: clampNum(settings.get("aiTemperature"), 0, 1, 0.7),
    systemPrompt: String(settings.get("aiSystemPrompt") || DEFAULT_AI_SYSTEM_PROMPT),
    sendContext: settings.get("aiSendContext") !== false,
    rateLimit: clampInt(settings.get("aiRateLimit"), 1, 120, 10),
    apiKey: getApiKey(),
  };
}

export function isAIEnabled() {
  return settings.get("aiEnabled") === true;
}

export function isAIConfigured() {
  const cfg = getAIConfig();
  if (!cfg.enabled) return false;
  if (!cfg.endpoint) return false;
  if (providerInfo(cfg.provider).needsKey && !cfg.apiKey) return false;
  return true;
}
