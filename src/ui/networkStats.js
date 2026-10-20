import { getNetCounters } from "../runtime/network.js";
import { multiClient } from "../runtime/multiClient.js";
import { engine } from "../runtime/engine.js";

let panel = null;
let timer = 0;
let body = null;
let chart = null;
let chartCtx = null;
let hint = null;
let prev = null;
let rate = null;
let history = [];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtBytes(v) {
  if (v == null || !Number.isFinite(v)) return "\u2014";
  if (v >= 1048576) return (v / 1048576).toFixed(2) + " MB/s";
  if (v >= 1024) return (v / 1024).toFixed(1) + " KB/s";
  return Math.round(v) + " B/s";
}

function sessionsForDisplay() {
  const sessions = multiClient.getSessions();
  if (sessions.length) return sessions;
  if (engine.isRunning() && engine.getMode() === "play") {
    return [{ id: 1, name: "Client 1", status: "connected" }];
  }
  return [];
}

function tick() {
  if (!panel || !body) return;
  const c = getNetCounters();
  if (prev) {
    rate = {
      sent: Math.max(0, c.bytesSent - prev.bytesSent),
      recv: Math.max(0, c.bytesReceived - prev.bytesReceived),
      pktsOut: Math.max(0, c.packetsSent - prev.packetsSent),
      pktsIn: Math.max(0, c.packetsReceived - prev.packetsReceived),
      re: Math.max(0, c.remoteEvents - prev.remoteEvents),
      rf: Math.max(0, c.remoteFunctions - prev.remoteFunctions),
    };
    history.push({ sent: rate.sent, recv: rate.recv });
    if (history.length > 60) history.splice(0, history.length - 60);
  }
  prev = c;

  const sessions = sessionsForDisplay();
  const frag = document.createDocumentFragment();
  if (!sessions.length) {
    hint.textContent = "Inicie o Playtest (aba Test) para coletar metricas de rede.";
  } else {
    hint.textContent = "Fio compartilhado Server \u2194 Clients \u2014 taxas globais por segundo. Fila de replicacao: " + c.queueSize + ".";
  }
  for (const s of sessions) {
    const tr = el("tr");
    if (s.status === "disconnected") tr.className = "rsw-stats__row--off";
    const active = multiClient.getSessions().length > 1 && multiClient.getActiveId() === s.id;
    tr.append(
      el("td", "rsw-stats__metric", s.name + (active ? " \u25cf" : "")),
      el("td", null, s.status === "disconnected" ? "\u2014" : fmtBytes(rate ? rate.sent : null)),
      el("td", null, s.status === "disconnected" ? "\u2014" : fmtBytes(rate ? rate.recv : null)),
      el("td", null, s.status === "disconnected" ? "\u2014" : (rate ? rate.pktsOut + rate.pktsIn : "\u2014") + ""),
      el("td", null, c.latencyMs > 0 ? c.latencyMs + "ms" : "Off"),
      el("td", null, c.packetLossPct + "%"),
      el("td", null, rate ? String(rate.re) : "\u2014"),
      el("td", null, rate ? String(rate.rf) : "\u2014"),
      el("td", null, String(c.queueSize)),
    );
    frag.appendChild(tr);
  }
  body.replaceChildren(frag);
  drawChart();
}

function drawChart() {
  if (!chartCtx || !chart) return;
  const W = chart.width;
  const H = chart.height;
  chartCtx.clearRect(0, 0, W, H);
  chartCtx.fillStyle = "#141416";
  chartCtx.fillRect(0, 0, W, H);
  let max = 128;
  for (const h of history) max = Math.max(max, h.sent, h.recv);
  chartCtx.strokeStyle = "#2c2c30";
  chartCtx.strokeRect(0.5, 0.5, W - 1, H - 1);
  const drawLine = (key, color) => {
    if (history.length < 2) return;
    chartCtx.strokeStyle = color;
    chartCtx.lineWidth = 1.5;
    chartCtx.beginPath();
    for (let i = 0; i < history.length; i++) {
      const x = (i / 59) * (W - 8) + 4;
      const y = H - 6 - (history[i][key] / max) * (H - 14);
      if (i === 0) chartCtx.moveTo(x, y);
      else chartCtx.lineTo(x, y);
    }
    chartCtx.stroke();
  };
  drawLine("sent", "#4caf6e");
  drawLine("recv", "#5bc8e8");
  chartCtx.font = "9px system-ui, sans-serif";
  chartCtx.fillStyle = "#9b9ba1";
  chartCtx.textAlign = "left";
  chartCtx.fillText("pico: " + fmtBytes(max), 6, 12);
}

export function isNetworkStatsVisible() {
  return !!panel;
}

export function openNetworkStats() {
  if (panel) return;
  prev = null;
  rate = null;
  history = [];
  panel = el("div", "rsw-stats rsw-stats--network");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Network Stats");
  const header = el("div", "rsw-stats__header");
  const title = el("span", "rsw-stats__title", "Network Stats");
  const closeBtn = el("button", "rsw-stats__close", "\u00d7");
  closeBtn.type = "button";
  closeBtn.title = "Fechar";
  closeBtn.addEventListener("click", () => closeNetworkStats());
  header.append(title, closeBtn);
  const table = el("table", "rsw-stats__table");
  const thead = el("thead");
  const hr = el("tr");
  for (const h of ["Client", "Sent/s", "Recv/s", "Pkts/s", "Latency", "Loss", "RE/s", "RF/s", "Queue"]) hr.appendChild(el("th", null, h));
  thead.appendChild(hr);
  body = el("tbody");
  table.append(thead, body);
  chart = el("canvas", "rsw-stats__chart");
  chart.width = 336;
  chart.height = 84;
  chartCtx = chart.getContext("2d");
  const legend = el("div", "rsw-stats__legend");
  const mkLeg = (color, label) => {
    const item = el("span", "rsw-mp__legenditem");
    const dot = el("span", "rsw-mp__dot");
    dot.style.background = color;
    item.append(dot, document.createTextNode(label));
    return item;
  };
  legend.append(mkLeg("#4caf6e", "Bytes enviados"), mkLeg("#5bc8e8", "Bytes recebidos"));
  hint = el("div", "rsw-stats__hint", "");
  panel.append(header, table, chart, legend, hint);
  document.body.appendChild(panel);

  let dragging = null;
  header.addEventListener("mousedown", (e) => {
    if (e.target === closeBtn) return;
    const rect = panel.getBoundingClientRect();
    dragging = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!dragging) return;
    panel.style.left = Math.max(0, e.clientX - dragging.dx) + "px";
    panel.style.top = Math.max(0, e.clientY - dragging.dy) + "px";
    panel.style.right = "auto";
  };
  const onUp = () => { dragging = null; };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  panel._cleanupDrag = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  tick();
  timer = setInterval(tick, 1000);
}

export function closeNetworkStats() {
  if (!panel) return;
  clearInterval(timer);
  timer = 0;
  if (panel._cleanupDrag) panel._cleanupDrag();
  panel.remove();
  panel = null;
  body = null;
  chart = null;
  chartCtx = null;
  hint = null;
  prev = null;
  history = [];
}

export function toggleNetworkStats() {
  if (panel) closeNetworkStats();
  else openNetworkStats();
}
