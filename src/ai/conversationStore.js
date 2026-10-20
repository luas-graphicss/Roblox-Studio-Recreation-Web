import { readJSON, writeJSON } from "../utils/storage.js";
import { project } from "../core/project.js";
import { createResourceId } from "../core/resourceId.js";           

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;
const MAX_TITLE = 80;

function projectKey() {
  let name = "default";
  try {
    name = String(project.getName() || "default");
  } catch (_) {}
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "default";
  return "aiConversations." + slug;
}

function validConversation(conv) {
  return !!(conv && typeof conv === "object" && typeof conv.id === "string" && Array.isArray(conv.messages));
}

function sanitizeMessages(messages) {
  return messages
    .filter((m) => m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }));
}

function loadAll() {
  const data = readJSON(projectKey());
  if (!Array.isArray(data)) return [];
  return data.filter(validConversation).map((c) => ({
    id: c.id,
    title: typeof c.title === "string" && c.title.trim() ? c.title.slice(0, MAX_TITLE) : "New Conversation",
    autoTitled: c.autoTitled === true,
    createdAt: Number(c.createdAt) || Date.now(),
    updatedAt: Number(c.updatedAt) || Date.now(),
    messages: sanitizeMessages(c.messages),
  }));
}

function persist(list) {
  const sorted = list.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
  writeJSON(projectKey(), sorted);
  return sorted;
}

export function createConversation() {
  const now = Date.now();
  return {
    id: createResourceId("c_"),
    title: "New Conversation",
    autoTitled: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function listConversations() {
  return loadAll()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, count: c.messages.length }));
}

export function getConversation(id) {
  return loadAll().find((c) => c.id === id) || null;
}

export function saveConversation(conv) {
  if (!validConversation(conv)) return false;
  const list = loadAll().filter((c) => c.id !== conv.id);
  list.push({
    id: conv.id,
    title: typeof conv.title === "string" && conv.title.trim() ? conv.title.slice(0, MAX_TITLE) : "New Conversation",
    autoTitled: conv.autoTitled === true,
    createdAt: Number(conv.createdAt) || Date.now(),
    updatedAt: Date.now(),
    messages: sanitizeMessages(conv.messages),
  });
  persist(list);
  return true;
}

export function deleteConversation(id) {
  const list = loadAll();
  const next = list.filter((c) => c.id !== id);
  if (next.length === list.length) return false;
  persist(next);
  return true;
}

export function renameConversation(id, title) {
  const list = loadAll();
  const conv = list.find((c) => c.id === id);
  if (!conv) return false;
  const t = String(title || "").trim().slice(0, MAX_TITLE);
  if (!t) return false;
  conv.title = t;
  conv.autoTitled = true;
  persist(list);
  return true;
}

export function exportConversationText(conv) {
  if (!validConversation(conv)) return "";
  const lines = [conv.title, new Date(conv.updatedAt || Date.now()).toLocaleString(), ""];
  for (const m of conv.messages) {
    lines.push((m.role === "user" ? "You:" : "Assistant:"));
    lines.push(m.content);
    lines.push("");
  }
  return lines.join("\n");
}
