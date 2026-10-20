import { bus } from "../core/eventBus.js";
import { streaming } from "../runtime/streaming.js";
import { buildStreamingClientsTable } from "./streamingStatsTable.js";

const TICK_MS = 500;

let panel = null;
let body = null;
let timer = 0;

function fmtPos(p) {
  if (!p) return "\u2014";
  return "(" + Math.round(p.x) + ", " + Math.round(p.y) + ", " + Math.round(p.z) + ")";
}

function ensurePanel() {
  if (panel) return;
  panel = document.createElement("div");
  panel.className = "rsw-stats rsw-stats--streaming";
  Object.assign(panel.style, {
    position: "fixed", right: "16px", bottom: "16px", zIndex: "60",
    minWidth: "360px", maxWidth: "520px", background: "rgba(20, 23, 30, 0.96)",
    color: "#dbe2ee", border: "1px solid #2a2f3a", borderRadius: "8px",
    font: "12px/1.5 system-ui, sans-serif", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    userSelect: "none",
  });

  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "6px 10px", borderBottom: "1px solid #2a2f3a", cursor: "move",
    fontWeight: "600",
  });
  header.textContent = "Streaming Debug";

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "\u00d7";
  Object.assign(closeBtn.style, {
    background: "none", border: "none", color: "#9aa3b2", cursor: "pointer",
    fontSize: "14px", lineHeight: "1", padding: "0 2px",
  });
  closeBtn.addEventListener("click", close);
  header.appendChild(closeBtn);

  body = document.createElement("div");
  Object.assign(body.style, { padding: "8px 10px", maxHeight: "320px", overflow: "auto" });

  panel.append(header, body);
  document.body.appendChild(panel);


  let dragState = null;
  header.addEventListener("pointerdown", (e) => {
    if (e.target === closeBtn) return;
    const rect = panel.getBoundingClientRect();
    dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = rect.left + "px";
    panel.style.top = rect.top + "px";
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    panel.style.left = Math.max(0, e.clientX - dragState.dx) + "px";
    panel.style.top = Math.max(0, e.clientY - dragState.dy) + "px";
  });
  header.addEventListener("pointerup", () => { dragState = null; });
}

function createTextLine(text, styleOverrides) {
  const line = document.createElement("div");
  Object.assign(line.style, styleOverrides);
  line.textContent = text;
  return line;
}

function buildRadiusSummaryLine(snapshot) {
  return createTextLine(
    "MinRadius " + snapshot.minRadius +
      " \u00b7 TargetRadius " + snapshot.targetRadius +
      " \u00b7 StreamOut " + snapshot.behavior,
    { marginBottom: "6px", opacity: ".85" },
  );
}

function buildLastRequestLine(client) {
  return createTextLine(
    "Client " + client.id +
      " \u00b7 RequestStreamAroundAsync " + fmtPos(client.lastRequest) +
      " \u2192 " + client.lastRequest.status,
    { marginTop: "4px", opacity: ".8" },
  );
}

function buildActiveFocusLine(snapshot) {
  const activeClient = snapshot.clients.find((client) => client.id === snapshot.activeClientId) || {};
  return createTextLine("Foco do cliente ativo: " + fmtPos(activeClient.focus), {
    marginTop: "4px",
    opacity: ".6",
  });
}

function tick() {
  if (!panel || !body) return;
  const snap = streaming.getDebugSnapshot();
  if (!snap.running) {
    body.replaceChildren(
      createTextLine("Playtest parado \u2014 inicie em modo Play para ver as m\u00e9tricas de streaming.", { opacity: ".7" }),
    );
    return;
  }
  if (!snap.enabled) {
    body.replaceChildren(
      createTextLine("Workspace.StreamingEnabled = false \u2014 cada Client recebe o Workspace inteiro.", { opacity: ".7" }),
    );
    return;
  }


  const renderedBlocks = [buildRadiusSummaryLine(snap), buildStreamingClientsTable(snap)];
  for (const client of snap.clients) {
    if (client.lastRequest) renderedBlocks.push(buildLastRequestLine(client));
  }
  renderedBlocks.push(buildActiveFocusLine(snap));
  body.replaceChildren(...renderedBlocks);
}

export function openStreamingStats() {
  ensurePanel();
  panel.style.display = "";
  if (!timer) timer = setInterval(tick, TICK_MS);
  tick();
}

export function close() {
  if (panel) panel.style.display = "none";
  if (timer) { clearInterval(timer); timer = 0; }
}

export function toggleStreamingStats() {
  if (isStreamingStatsVisible()) close();
  else openStreamingStats();
}

export function isStreamingStatsVisible() {
  return !!(panel && panel.style.display !== "none");
}

bus.on("streamingstats:toggle", toggleStreamingStats);
