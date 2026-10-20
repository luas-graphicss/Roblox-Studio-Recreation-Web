import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { createIcon } from "./icons.js";
import { openContextMenu } from "./contextMenu.js";
import { openModal, openConfirm, openPrompt, makeButton, _el as el } from "./modal.js";
import { openStudioSettings } from "./dialogs/studioSettings.js";
import { NotificationService } from "../services/notifications.js";            
import { aiClient } from "../ai/aiClient.js";
import { isAIEnabled, isAIConfigured, getAIConfig } from "../ai/aiConfig.js";
import { buildContext, contextToText } from "../ai/aiContext.js";
import { renderHighlightedCode } from "./syntaxHighlightRenderer.js";
import {
  parseAssistantMessage,
  applyActions,
  validateActions,
  describeAction,
  previewAction,
  isUnsafeAction,
} from "../ai/aiActions.js";
import * as convStore from "../ai/conversationStore.js";
import { canInsertIntoScript, insertIntoActiveScript } from "../ai/editorBridge.js";
import { insertScript, insertLocalScript, insertModuleScript } from "./scriptOps.js";

const AUTO_TITLE_PROMPT =
  "Write a very short title (max 6 words) for this conversation. Reply with the title only, no quotes.";

function copyText(text) {
  const value = String(text == null ? "" : text);
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {}
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (_) {}
  ta.remove();
  return true;
}

function highlightCode(target, code, lang) {
  target.textContent = code;
  const m = globalThis.monaco;
  if (m && m.editor && typeof m.editor.colorize === "function") {
    m.editor
      .colorize(code, lang === "json" ? "json" : "luau", { tabSize: 2 })
      .then((highlightedMarkup) => {


        renderHighlightedCode(target, highlightedMarkup, code);
      })
      .catch(() => {});
  }
}

export function buildAssistantPanel(dockRefs) {
  const header = dockRefs.header;
  const body = dockRefs.body;

  let conv = convStore.createConversation();
  let sending = false;
  let abortCtrl = null;
  let historyOpen = false;
  let pendingRender = false;
  const chips = { selection: true, script: true, errors: true };

  const root = el("div", "rsw-assistant");
  const sidebar = el("div", "rsw-assistant__sidebar");
  const main = el("div", "rsw-assistant__main");
  root.append(sidebar, main);
  body.appendChild(root);

  const messagesEl = el("div", "rsw-assistant__messages");
  const chipsRow = el("div", "rsw-assistant__chips");
  const inputRow = el("div", "rsw-assistant__inputrow");

  const input = document.createElement("textarea");
  input.className = "rsw-assistant__input";
  input.rows = 1;
  input.placeholder = "Ask the Assistant... (Enter to send, Shift+Enter for a new line)";
  input.setAttribute("spellcheck", "false");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener("input", autoGrow);

  const sendBtn = makeButton("Send", "primary", () => send());
  sendBtn.classList.add("rsw-assistant__btn");
  const stopBtn = makeButton("Stop", "ghost", stopSending);
  stopBtn.classList.add("rsw-assistant__btn");
  stopBtn.hidden = true;
  inputRow.append(input, sendBtn, stopBtn);

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(140, Math.max(28, input.scrollHeight)) + "px";
  }

  function toolButton(title, content, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rsw-assistant__toolbtn";
    b.title = title;
    b.setAttribute("aria-label", title);
    if (content instanceof Node) b.appendChild(content);
    else b.textContent = content;
    b.addEventListener("click", onClick);
    return b;
  }

  const tools = el("div", "rsw-assistant__tools");
  tools.append(
    toolButton("Conversation history", createIcon("listView", 13), toggleHistory),
    toolButton("New Conversation", createIcon("create", 13), newConversation),
    toolButton("View Context", createIcon("info", 13), openContextModal),
    toolButton("AI Settings", createIcon("settings", 13), () => openStudioSettings("ai")),
  );
  if (dockRefs.close && dockRefs.close.parentNode === header) header.insertBefore(tools, dockRefs.close);
  else header.appendChild(tools);

  function smallButton(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rsw-assistant__btn rsw-assistant__btn--small";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  function flash(btn, text) {
    const prev = btn.textContent;
    btn.textContent = text;
    setTimeout(() => {
      btn.textContent = prev;
    }, 1200);
  }

  function chipButton(label, key) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rsw-assistant__chip" + (chips[key] ? " is-on" : "");
    b.textContent = label;
    b.title = "Toggle whether this information is sent with your next message";
    b.addEventListener("click", () => {
      chips[key] = !chips[key];
      b.classList.toggle("is-on", chips[key]);
    });
    return b;
  }

  const viewCtxChip = document.createElement("button");
  viewCtxChip.type = "button";
  viewCtxChip.className = "rsw-assistant__chip rsw-assistant__chip--link";
  viewCtxChip.textContent = "View Context";
  viewCtxChip.addEventListener("click", openContextModal);
  chipsRow.append(
    chipButton("Include Selection", "selection"),
    chipButton("Include Current Script", "script"),
    chipButton("Include Recent Errors", "errors"),
    viewCtxChip,
  );

  function currentContextSections() {
    return buildContext({
      includeSelection: chips.selection,
      includeScript: chips.script,
      includeErrors: chips.errors,
    });
  }

  function openContextModal() {
    const text = contextToText(currentContextSections()) || "No context will be sent.";
    const box = el("div", "rsw-assistant-context");
    const pre = el("pre");
    pre.textContent = text;
    box.appendChild(pre);
    openModal({ title: "Context sent to the AI", body: box, width: 640 });
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderAll() {
    main.textContent = "";
    if (!isAIEnabled()) {
      main.appendChild(
        setupScreen(
          "AI features are disabled. Configure in Studio Settings > AI.",
          "Open Studio Settings",
        ),
      );
      return;
    }
    if (!isAIConfigured()) {
      main.appendChild(
        setupScreen(
          "Almost there. Choose a provider and add your API key to start using the Assistant.",
          "Configure AI Provider",
        ),
      );
      return;
    }
    main.append(messagesEl, chipsRow, inputRow);
    renderMessages();
  }

  function setupScreen(message, buttonLabel) {
    const box = el("div", "rsw-assistant__setup");
    const msg = el("p", null, message);
    const btn = makeButton(buttonLabel, "primary", () => openStudioSettings("ai"));
    box.append(msg, btn);
    return box;
  }

  function renderMessages() {
    messagesEl.textContent = "";
    if (!conv.messages.length) {
      const empty = el(
        "div",
        "rsw-assistant__empty",
        "Ask about your place, request Luau code or let the Assistant create objects for you.",
      );
      messagesEl.appendChild(empty);
      return;
    }
    for (const m of conv.messages) messagesEl.appendChild(renderMessage(m));
    scrollToBottom();
  }

  function renderMessage(m) {
    if (m.role === "user") {
      const wrap = el("div", "rsw-assistant__msg rsw-assistant__msg--user");
      wrap.textContent = m.content;
      return wrap;
    }
    const wrap = el("div", "rsw-assistant__msg rsw-assistant__msg--assistant");
    renderAssistantContent(wrap, m.content);
    return wrap;
  }

  function renderAssistantContent(wrap, text) {
    const segments = parseAssistantMessage(text);
    const actions = segments.filter((s) => s.type === "action").map((s) => s.action);
    for (const seg of segments) {
      if (seg.type === "text") {
        const p = el("div", "rsw-assistant__text");
        p.textContent = seg.text.trim();
        wrap.appendChild(p);
      } else if (seg.type === "code") {
        wrap.appendChild(codeCard(seg));
      } else {
        wrap.appendChild(actionCard(seg.action));
      }
    }
    if (actions.length > 1) {
      const row = el("div", "rsw-assistant__actionfoot rsw-assistant__actionfoot--all");
      const state = el("span", "rsw-assistant__actionstate");
      const btn = smallButton("Apply All (" + actions.length + ")", () =>
        confirmAndApply(actions, state, [btn]),
      );
      row.append(btn, state);
      wrap.appendChild(row);
    }
  }

  function codeCard(seg) {
    const card = el("div", "rsw-assistant__codecard");
    const head = el("div", "rsw-assistant__codehead");
    const label = el("span", "rsw-assistant__codelang", seg.lang || "luau");
    const btns = el("div", "rsw-assistant__codebtns");
    const copyBtn = smallButton("Copy", () => {
      copyText(seg.code);
      flash(copyBtn, "Copied");
    });
    const insertBtn = smallButton("Insert into Script", () => {
      if (insertIntoActiveScript(seg.code)) flash(insertBtn, "Inserted");
      else flash(insertBtn, "No script open");
    });
    insertBtn.classList.toggle("is-dim", !canInsertIntoScript());
    card.addEventListener("mouseenter", () => insertBtn.classList.toggle("is-dim", !canInsertIntoScript()));
    const createBtn = smallButton("Create Script", (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      openContextMenu({
        x: rect.left,
        y: rect.bottom + 2,
        items: ["Script", "LocalScript", "ModuleScript"].map((cls) => ({
          label: cls,
          onSelect: () => createScriptWithCode(cls, seg.code, createBtn),
        })),
      });
    });
    btns.append(copyBtn, insertBtn, createBtn);
    head.append(label, btns);
    const codeBody = el("pre", "rsw-assistant__codebody");
    highlightCode(codeBody, seg.code, seg.lang);
    card.append(head, codeBody);
    return card;
  }

  function createScriptWithCode(cls, code, btn) {
    const inst =
      cls === "LocalScript" ? insertLocalScript() : cls === "ModuleScript" ? insertModuleScript() : insertScript();
    if (!inst || typeof inst.setProperty !== "function") {
      flash(btn, "Could not create");
      return;
    }
    try {
      inst.setProperty("Source", String(code || ""));
    } catch (_) {}
    if (typeof inst.setAttribute === "function") {
      try {
        inst.setAttribute("GeneratedByAI", "boolean", true);
      } catch (_) {}
    }
    flash(btn, "Created " + cls);
  }

  function actionCard(action) {
    const card = el("div", "rsw-assistant__actioncard");
    const head = el("div", "rsw-assistant__actionhead", describeAction(action));
    const pre = el("pre", "rsw-assistant__actionpreview");
    pre.textContent = previewAction(action);
    const foot = el("div", "rsw-assistant__actionfoot");
    const state = el("span", "rsw-assistant__actionstate");
    const applyBtn = smallButton("Apply", () => confirmAndApply([action], state, [applyBtn, skipBtn]));
    const skipBtn = smallButton("Skip", () => {
      state.textContent = "Skipped";
      applyBtn.disabled = true;
      skipBtn.disabled = true;
    });
    foot.append(applyBtn, skipBtn, state);
    card.append(head, pre, foot);
    return card;
  }

  async function confirmAndApply(actions, stateEl, buttons) {


    const batchCheck = validateActions(actions);
    if (!batchCheck.ok) {
      stateEl.textContent = batchCheck.error;
      return;
    }
    const summary = actions.map(describeAction).join(" \u2022 ");
    const ok = await openConfirm({
      title: "Apply Assistant actions",
      message: "The Assistant wants to modify the place: " + summary,
      buttons: [
        { label: "Cancel", value: null, kind: "ghost" },
        { label: "Apply", value: true, kind: "primary" },
      ],
    });
    if (ok !== true) return;
    if (actions.some(isUnsafeAction)) {
      const sure = await openConfirm({
        title: "Confirm destructive action",
        message:
          "One or more actions delete instances or overwrite script source. This can remove existing work. Continue?",
        buttons: [
          { label: "Cancel", value: null, kind: "ghost" },
          { label: "Continue", value: true, kind: "primary" },
        ],
      });
      if (sure !== true) return;
    }
    const result = applyActions(actions, "AI Assistant actions");
    if (result.ok) {

      stateEl.textContent = result.failed > 0
        ? "Applied " + result.applied + " of " + (result.applied + result.failed) + " action(s); " + result.failed + " failed (see Output). Ctrl+Z undoes the applied ones."
        : "Applied " + result.applied + " action(s). Ctrl+Z undoes everything.";
      for (const b of buttons) b.disabled = true;
    } else {
      stateEl.textContent = result.error || "The actions could not be applied.";
    }
  }

  function updateSendButtons() {
    sendBtn.hidden = sending;
    stopBtn.hidden = !sending;
  }

  function stopSending() {
    if (abortCtrl) {
      try {
        abortCtrl.abort();
      } catch (_) {}
    }
  }

  function finishSend() {
    sending = false;
    abortCtrl = null;
    updateSendButtons();
    refreshSidebar();
    if (pendingRender) {
      pendingRender = false;
      renderAll();
    }
  }

  async function send(forcedText) {
    if (sending) return;
    if (!isAIConfigured()) {
      renderAll();
      return;
    }
    const text = String(forcedText != null ? forcedText : input.value).trim();
    if (!text) return;
    if (forcedText == null) {
      input.value = "";
      autoGrow();
    }
    if (messagesEl.parentNode !== main) renderAll();
    const target = conv;
    target.messages.push({ role: "user", content: text });
    convStore.saveConversation(target);
    renderMessages();
    sending = true;
    updateSendButtons();
    const streamEl = el("div", "rsw-assistant__msg rsw-assistant__msg--assistant rsw-assistant__streaming");
    messagesEl.appendChild(streamEl);
    scrollToBottom();
    abortCtrl = typeof AbortController === "function" ? new AbortController() : null;
    const cfg = getAIConfig();
    const messages = [{ role: "system", content: cfg.systemPrompt }];
    if (cfg.sendContext) {
      const ctx = contextToText(currentContextSections());
      if (ctx) messages.push({ role: "system", content: ctx });
    }
    for (const m of target.messages.slice(-30)) messages.push({ role: m.role, content: m.content });
    let full = "";
    try {
      full = await aiClient.chatStream(messages, {
        signal: abortCtrl ? abortCtrl.signal : undefined,
        onToken: (_token, acc) => {
          full = acc;
          streamEl.textContent = acc;
          scrollToBottom();
        },
      });
    } catch (e) {
      if (!(e && e.name === "AbortError")) {
        streamEl.remove();
        const err = el("div", "rsw-assistant__msg rsw-assistant__msg--error");
        err.textContent = e && e.message ? e.message : "The AI request failed.";
        NotificationService.notify("error", "AI Assistant: " + (e && e.message ? e.message : "provider connection failed"));            
        messagesEl.appendChild(err);
        scrollToBottom();
        finishSend();
        return;
      }
      if (!full) {
        streamEl.remove();
        finishSend();
        return;
      }
    }
    streamEl.remove();
    const stillExists = target === conv || !!convStore.getConversation(target.id);
    if (full && stillExists) {
      target.messages.push({ role: "assistant", content: full });
      convStore.saveConversation(target);
      if (target === conv) {
        messagesEl.appendChild(renderMessage(target.messages[target.messages.length - 1]));
        scrollToBottom();
      }
      maybeAutoTitle(target);
    }
    finishSend();
  }

  async function maybeAutoTitle(target) {
    if (target.autoTitled) return;
    const answers = target.messages.filter((m) => m.role === "assistant").length;
    if (answers < 2) return;
    const transcript = target.messages
      .slice(0, 6)
      .map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.content.slice(0, 300))
      .join("\n");
    try {
      const title = await aiClient.completeOnce(
        [
          { role: "system", content: AUTO_TITLE_PROMPT },
          { role: "user", content: transcript },
        ],
        { maxTokens: 24 },
      );
      const clean = String(title || "").replace(/["\n]/g, "").trim().slice(0, 60);
      if (clean && !target.autoTitled && convStore.getConversation(target.id)) {
        target.title = clean;
        target.autoTitled = true;
        convStore.saveConversation(target);
        refreshSidebar();
      }
    } catch (_) {}
  }

  function toggleHistory() {
    historyOpen = !historyOpen;
    root.classList.toggle("rsw-assistant--history", historyOpen);
    if (historyOpen) refreshSidebar();
  }

  function refreshSidebar() {
    sidebar.textContent = "";
    const items = convStore.listConversations();
    if (!items.length) {
      sidebar.appendChild(el("div", "rsw-assistant__convempty", "No conversations yet"));
      return;
    }
    for (const item of items) {
      const row = el("div", "rsw-assistant__convitem" + (item.id === conv.id ? " is-active" : ""));
      row.append(
        el("div", "rsw-assistant__convtitle", item.title),
        el("div", "rsw-assistant__convdate", new Date(item.updatedAt).toLocaleDateString()),
      );
      row.addEventListener("click", () => openConversation(item.id));
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        conversationMenu(e, item);
      });
      sidebar.appendChild(row);
    }
  }

  function conversationMenu(e, item) {
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Rename", onSelect: () => renameConversationFlow(item) },
        { label: "Export as Text", onSelect: () => exportConversation(item.id) },
        { type: "separator" },
        { label: "Delete", icon: "trash", onSelect: () => deleteConversationFlow(item.id) },
      ],
    });
  }

  async function renameConversationFlow(item) {
    const name = await openPrompt({
      title: "Rename conversation",
      label: "Title",
      value: item.title,
      maxLength: 80,
    });
    if (name == null || !name.trim()) return;
    convStore.renameConversation(item.id, name.trim());
    if (conv.id === item.id) {
      conv.title = name.trim();
      conv.autoTitled = true;
    }
    refreshSidebar();
  }

  function exportConversation(id) {
    const c = id === conv.id ? conv : convStore.getConversation(id);
    if (!c) return;
    const text = convStore.exportConversationText(c);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (c.title || "conversation").replace(/[^\w-]+/g, "_").slice(0, 60) + ".txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function deleteConversationFlow(id) {
    const ok = await openConfirm({
      title: "Delete conversation",
      message: "Delete this conversation? This cannot be undone.",
      buttons: [
        { label: "Cancel", value: null, kind: "ghost" },
        { label: "Delete", value: true, kind: "primary" },
      ],
    });
    if (ok !== true) return;
    convStore.deleteConversation(id);
    if (conv.id === id) {
      if (sending) stopSending();
      conv = convStore.createConversation();
      renderMessages();
    }
    refreshSidebar();
  }

  function openConversation(id) {
    if (sending) stopSending();
    const c = convStore.getConversation(id);
    if (!c) return;
    conv = c;
    renderMessages();
    refreshSidebar();
  }

  function newConversation() {
    if (sending) stopSending();
    conv = convStore.createConversation();
    renderMessages();
    refreshSidebar();
  }

  function safeRenderAll() {
    if (sending) {
      pendingRender = true;
      return;
    }
    renderAll();
  }

  bus.on("settings:changed", (payload) => {
    const key = payload && payload.key;
    if (typeof key === "string" && key.startsWith("ai")) safeRenderAll();
  });
  bus.on("settings:reset", () => safeRenderAll());

  bus.on("assistant:open", (payload) => {
    store.setLayout({ panels: { assistant: true } });
    const p = payload || {};
    if (!isAIConfigured()) {
      renderAll();
      return;
    }
    if (messagesEl.parentNode !== main) renderAll();
    if (typeof p.prompt === "string" && p.prompt) {
      if (p.send === true && !sending) {
        send(p.prompt);
      } else {
        input.value = p.prompt;
        autoGrow();
        setTimeout(() => input.focus(), 0);
      }
    } else {
      setTimeout(() => input.focus(), 0);
    }
  });

  renderAll();
  refreshSidebar();

  return { refresh: renderAll };
}
