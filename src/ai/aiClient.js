import { getAIConfig, providerInfo } from "./aiConfig.js";
import { mayAttachCredential } from "./endpointPolicy.js";

const RATE_WINDOW_MS = 60000;


function mayAttachApiKey(cfg) {
  return !!cfg.apiKey && mayAttachCredential(cfg.endpoint);
}

function buildAnthropicHeaders(cfg) {
  const headers = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (mayAttachApiKey(cfg)) headers["x-api-key"] = cfg.apiKey;
  return headers;
}

class RateLimiter {
  constructor() {
    this._stamps = [];
  }

  _prune() {
    const now = Date.now();
    while (this._stamps.length && now - this._stamps[0] > RATE_WINDOW_MS) this._stamps.shift();
  }

  wouldAllow(max) {
    this._prune();
    return this._stamps.length < max;
  }

  remaining(max) {
    this._prune();
    return Math.max(0, max - this._stamps.length);
  }

  consume(max) {
    this._prune();
    if (this._stamps.length >= max) return false;
    this._stamps.push(Date.now());
    return true;
  }
}

export class AIRequestError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AIRequestError";
    this.code = code || "request";
  }
}

function splitSystem(messages) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: String(m.content || "") }));
  return { system, rest };
}









export function normalizeAnthropicTurns(rest) {
  const out = [];
  for (const m of Array.isArray(rest) ? rest : []) {
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const content = String(m && m.content != null ? m.content : "");
    if (!content.trim()) continue;
    const prev = out.length ? out[out.length - 1] : null;
    if (prev && prev.role === role) prev.content += "\n\n" + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

function buildRequest(cfg, messages, stream) {
  if (cfg.wire === "anthropic") {
    const { system, rest } = splitSystem(messages);
    const turns = normalizeAnthropicTurns(rest);


    if (!turns.length) throw new AIRequestError("Nothing to send: the conversation has no user message.", "request");
    return {
      url: cfg.endpoint,
      headers: buildAnthropicHeaders(cfg),
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        system,
        messages: turns,
        stream,
      }),
    };
  }
  if (cfg.wire === "ollama") {
    return {
      url: cfg.endpoint,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream,
        options: { temperature: cfg.temperature, num_predict: cfg.maxTokens },
      }),
    };
  }
  const headers = { "content-type": "application/json" };
  if (mayAttachApiKey(cfg)) headers.authorization = "Bearer " + cfg.apiKey;
  return {
    url: cfg.endpoint,
    headers,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      stream,
    }),
  };
}

function extractStreamToken(cfg, payload) {
  if (!payload || typeof payload !== "object") return "";
  if (cfg.wire === "anthropic") {
    if (payload.type === "content_block_delta" && payload.delta) return payload.delta.text || "";
    return "";
  }
  if (cfg.wire === "ollama") {
    return payload.message ? payload.message.content || "" : "";
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  if (!choice) return "";
  if (choice.delta && typeof choice.delta.content === "string") return choice.delta.content;


  if (choice.delta && Array.isArray(choice.delta.content)) {
    return choice.delta.content
      .map((p) => (p && typeof p.text === "string" ? p.text : typeof p === "string" ? p : ""))
      .join("");
  }
  if (typeof choice.text === "string") return choice.text;
  return "";
}


export function extractFullText(cfg, payload) {
  if (!payload || typeof payload !== "object") return "";
  if (cfg.wire === "anthropic") {


    const blocks = Array.isArray(payload.content) ? payload.content.filter((b) => b && b.type === "text") : [];
    return blocks.map((b) => (typeof b.text === "string" ? b.text : "")).join("");
  }
  if (cfg.wire === "ollama") {
    return payload.message ? payload.message.content || "" : "";
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
  if (!choice) return "";
  if (choice.message && typeof choice.message.content === "string") return choice.message.content;


  if (choice.message && Array.isArray(choice.message.content)) {
    return choice.message.content
      .map((p) => (p && typeof p.text === "string" ? p.text : typeof p === "string" ? p : ""))
      .join("");
  }
  if (typeof choice.text === "string") return choice.text;
  return "";
}


function extractPayloadError(payload) {
  if (!payload || typeof payload !== "object") return null;
  const err = payload.type === "error" ? payload.error || payload : payload.error;
  if (!err) return null;
  if (typeof err === "string") return err;
  if (typeof err === "object") return String(err.message || err.type || "provider error");
  return "provider error";
}

function throwIfPayloadError(payload) {
  const msg = extractPayloadError(payload);
  if (msg) throw new AIRequestError("Provider error: " + String(msg).slice(0, 200), "http");
}

async function safeErrorDetail(response) {
  try {
    const text = await response.text();
    return String(text || "").slice(0, 200);
  } catch (_) {
    return "";
  }
}

async function readStream(cfg, response, onToken) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let data = line;
      if (data.startsWith("data:")) data = data.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let payload = null;
      try {
        payload = JSON.parse(data);
      } catch (_) {
        continue;
      }
      const errMsg = extractPayloadError(payload);
      if (errMsg) {


        try {
          reader.cancel();
        } catch (_) {}
        throw new AIRequestError("Provider error: " + String(errMsg).slice(0, 200), "http");
      }
      const token = extractStreamToken(cfg, payload);
      if (token) {
        full += token;
        if (onToken) onToken(token, full);
      }
    }
  }


  buffer += decoder.decode();
  for (const rawLine of buffer.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let data = line;
    if (data.startsWith("data:")) data = data.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let payload = null;
    try {
      payload = JSON.parse(data);
    } catch (_) {
      continue;
    }
    throwIfPayloadError(payload);
    const token = extractStreamToken(cfg, payload);
    if (token) {
      full += token;
      if (onToken) onToken(token, full);
    }
  }
  return full;
}

class AIClient {
  constructor() {
    this._limiter = new RateLimiter();
  }

  isRateLimited() {
    const cfg = getAIConfig();
    return !this._limiter.wouldAllow(cfg.rateLimit);
  }


  rateLimitRemaining() {
    const cfg = getAIConfig();
    return this._limiter.remaining(cfg.rateLimit);
  }

  _prepare(cfg) {
    if (!cfg.enabled) throw new AIRequestError("AI features are disabled.", "disabled");
    if (!cfg.endpoint) throw new AIRequestError("No AI endpoint configured.", "config");
    if (providerInfo(cfg.provider).needsKey && !cfg.apiKey) throw new AIRequestError("No API key configured.", "config");
    if (!this._limiter.consume(cfg.rateLimit)) throw new AIRequestError("Rate limit reached. Wait a moment and try again.", "rateLimit");
  }

  async _fetch(req, signal) {
    try {
      return await fetch(req.url, { method: "POST", headers: req.headers, body: req.body, signal });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw new AIRequestError("Could not reach the AI provider: " + (e && e.message ? e.message : "network error"), "network");
    }
  }

  async chatStream(messages, opts = {}) {
    const cfg = getAIConfig();
    this._prepare(cfg);
    const req = buildRequest(cfg, messages, true);
    const response = await this._fetch(req, opts.signal);
    if (!response.ok) {
      const detail = await safeErrorDetail(response);
      throw new AIRequestError("Provider error " + response.status + (detail ? ": " + detail : ""), "http");
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      const payload = await response.json().catch(() => null);
      throwIfPayloadError(payload);
      const text = extractFullText(cfg, payload);
      if (opts.onToken && text) opts.onToken(text, text);
      return text;
    }
    return readStream(cfg, response, opts.onToken);
  }

  async completeOnce(messages, opts = {}) {
    const cfg = getAIConfig();
    if (opts.maxTokens) cfg.maxTokens = Math.max(16, Math.min(cfg.maxTokens, opts.maxTokens));
    this._prepare(cfg);
    const req = buildRequest(cfg, messages, false);
    const response = await this._fetch(req, opts.signal);
    if (!response.ok) {
      const detail = await safeErrorDetail(response);
      throw new AIRequestError("Provider error " + response.status + (detail ? ": " + detail : ""), "http");
    }
    const payload = await response.json().catch(() => null);
    throwIfPayloadError(payload);
    return extractFullText(cfg, payload);
  }
}

export const aiClient = new AIClient();
