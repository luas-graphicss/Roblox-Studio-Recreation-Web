import { engine, PlaytestState, RuntimeEvents } from "../runtime/engine.js";
import { multiClient, MAX_CLIENTS } from "../runtime/multiClient.js";
import { emulation, EMULATION_DEVICES } from "../runtime/emulation.js";
import { getNetworkSettings, setNetworkSetting, LATENCY_OPTIONS, PACKET_LOSS_OPTIONS } from "../runtime/network.js";
import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { settings } from "../config/settings.js";
import * as monetization from "../runtime/monetization.js";
import { createIcon } from "./icons.js";
import { attachTooltip } from "./tooltip.js";
import { openContextMenu } from "./contextMenu.js";
import { toggleMicroProfiler, isMicroProfilerVisible } from "./microProfiler.js";
import { toggleSummaryStats, isSummaryStatsVisible } from "./summaryStats.js";
import { toggleNetworkStats, isNetworkStatsVisible } from "./networkStats.js";
import { toggleValidationPanel, isValidationPanelVisible } from "./validationPanel.js";

const CLICK_COOLDOWN = 120;

function setNet(key, value) {
  setNetworkSetting(key, value);
  bus.emit("network:settingsChanged", getNetworkSettings());
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function buildRibbonTest() {
  const root = el("div", "rsw-ribbon rsw-ribbon--test");
  const buttons = [];
  let lastClick = 0;
  let playersInput = null;

  function safeRun(fn) {
    const now = Date.now();
    if (now - lastClick < CLICK_COOLDOWN) return;
    lastClick = now;
    try {
      fn();
    } catch (err) {


      console.error(
        "[RSW] Test Ribbon: erro ao executar a\u00e7\u00e3o: " + ((err && err.message) || String(err)),
        (err && err.stack) || err,
      );
    }
    refresh();
  }

  function buildButton(entry) {
    const large = entry.size === "large";
    const btn = el("button", "rsw-rtool" + (large ? " rsw-rtool--large" : " rsw-rtool--small"));
    btn.type = "button";
    const icon = el("span", "rsw-rtool__icon");
    icon.appendChild(createIcon(entry.icon, large ? 26 : 16));
    const label = el("span", "rsw-rtool__label", entry.label);
    btn.append(icon, label);
    if (entry.options) {
      btn.classList.add("rsw-rtool--hasdrop");
      btn.appendChild(el("span", "rsw-rtool__arrow", "\u25be"));
    }
    const descText = typeof entry.desc === "function" ? entry.desc() : entry.desc;
    attachTooltip(btn, { title: entry.label, desc: descText || "" });
    btn.addEventListener("click", (e) => {
      if (entry.options) {
        const items = entry.options().map((opt) => ({
          label: (opt.checked ? "\u2713 " : "\u2003") + opt.label,
          onSelect: () => safeRun(opt.run),                                                                                                   
        }));
        const rect = btn.getBoundingClientRect();
        openContextMenu({ x: rect.left, y: rect.bottom + 2, items });
        e.stopPropagation();
        return;
      }
      if (entry.onRun) safeRun(entry.onRun);
    });
    buttons.push({ btn, entry });
    return btn;
  }

  function buildGroup(title, entries) {
    const group = el("div", "rsw-rgroup");
    const tools = el("div", "rsw-rgroup__tools");
    const larges = entries.filter((e) => e.size === "large");
    const smalls = entries.filter((e) => e.size !== "large");
    for (const entry of larges) tools.appendChild(buildButton(entry));

    for (let i = 0; i < smalls.length; i += 3) {
      const col = el("div", "rsw-rgroup__col");
      for (const entry of smalls.slice(i, i + 3)) col.appendChild(buildButton(entry));
      tools.appendChild(col);
    }
    group.append(tools, el("div", "rsw-rgroup__title", title));
    return group;
  }

  function buildClientsGroup() {
    const group = el("div", "rsw-rgroup");
    const tools = el("div", "rsw-rgroup__tools");

    const startBtn = el("button", "rsw-rtool rsw-rtool--large");
    startBtn.type = "button";
    const icon = el("span", "rsw-rtool__icon");
    icon.appendChild(createIcon("run", 26));
    startBtn.append(icon, el("span", "rsw-rtool__label", "Start"));
    attachTooltip(startBtn, { title: "Start", desc: "Inicia o Playtest com N clientes simulados (max. " + MAX_CLIENTS + ")." });
    startBtn.addEventListener("click", () => safeRun(() => multiClient.start()));

    const field = el("div", "rsw-testclients");
    const spin = el("div", "rsw-spin");
    const dec = el("button", "rsw-spin__btn", "\u2212");
    dec.type = "button";
    dec.setAttribute("aria-label", "Menos players");
    playersInput = el("input", "rsw-spin__input");
    playersInput.type = "number";
    playersInput.min = "1";
    playersInput.max = String(MAX_CLIENTS);
    playersInput.value = String(multiClient.getPlayerCount());
    playersInput.setAttribute("aria-label", "Quantidade de players");
    const inc = el("button", "rsw-spin__btn", "+");
    inc.type = "button";
    inc.setAttribute("aria-label", "Mais players");
    const commit = (v) => {
      playersInput.value = String(multiClient.setPlayerCount(v));
    };
    dec.addEventListener("click", () => commit(multiClient.getPlayerCount() - 1));
    inc.addEventListener("click", () => commit(multiClient.getPlayerCount() + 1));
    playersInput.addEventListener("change", () => commit(playersInput.value));
    spin.append(dec, playersInput, inc);
    field.append(spin, el("div", "rsw-spin__label", "Players"));
    attachTooltip(field, { title: "Players", desc: "Quantos clientes simular ao clicar em Start (1 a " + MAX_CLIENTS + ")." });

    tools.append(startBtn, field);
    group.append(tools, el("div", "rsw-rgroup__title", "Clients"));
    return group;
  }

  function buildWalletGroup() {
    const group = el("div", "rsw-rgroup");
    const tools = el("div", "rsw-rgroup__tools");
    const field = el("div", "rsw-testclients");
    const spin = el("div", "rsw-spin");
    const input = el("input", "rsw-spin__input");
    input.type = "number";
    input.min = "0";
    input.max = "999999";
    input.style.width = "72px";
    input.value = String(settings.get("robuxDefaultBalance"));
    input.setAttribute("aria-label", "Simulated Robux Balance");
    const commit = (v) => {
      const n = Math.max(0, Math.min(999999, Math.round(Number(v) || 0)));
      settings.set("robuxDefaultBalance", n);
      if (engine.isRunning()) monetization.setAllBalances(n);
      input.value = String(n);
    };
    input.addEventListener("change", () => commit(input.value));
    bus.on("settings:changed", (p) => {
      if (p && p.key === "robuxDefaultBalance" && document.activeElement !== input) {
        input.value = String(p.value);
      }
    });
    bus.on("settings:reset", () => {
      if (document.activeElement !== input) {
        input.value = String(settings.get("robuxDefaultBalance"));
      }
    });
    spin.appendChild(input);
    field.append(spin, el("div", "rsw-spin__label", "Robux"));
    attachTooltip(field, {
      title: "Simulated Robux Balance",
      desc: "Saldo inicial de Robux de cada cliente simulado (0 a 999999). Alterar durante o Playtest aplica o valor a todos os clientes.",
    });
    tools.appendChild(field);
    group.append(tools, el("div", "rsw-rgroup__title", "Wallet"));
    return group;
  }

  const playtestEntries = [
    { label: "Play", icon: "run", size: "large", desc: "Inicia o Playtest com personagem (F5).", onRun: () => { if (!engine.isRunning()) engine.play(); }, getActive: () => engine.getPlaytestState() === PlaytestState.Play || (engine.isRunning() && engine.getMode() === "play") },
    { label: "Play Here", icon: "cursor", size: "small", desc: "Inicia o Play a partir da posicao da camera (F6).", onRun: () => { if (!engine.isRunning()) engine.playHere(); } },
    { label: "Run", icon: "command", size: "small", desc: "Executa apenas o Server, sem personagem (F8).", onRun: () => { if (!engine.isRunning()) engine.run(); }, getActive: () => engine.isRunning() && engine.getMode() === "run" },
    { label: "Pause", icon: "progressbar", size: "small", desc: "Pausa/retoma o Playtest (F7).", onRun: () => { if (engine.isRunning()) engine.togglePause(); }, getActive: () => engine.getPlaytestState() === PlaytestState.Paused },
    { label: "Stop", icon: "object", size: "small", desc: "Encerra o Playtest e restaura a cena (Shift+F5).", onRun: () => { if (engine.isRunning()) engine.stop(); } },
  ];

  const emulationEntries = [
    {
      label: "Device", icon: "ui", size: "large",
      desc: () => "Dispositivo emulado: " + (emulation.getDevice() ? emulation.getDevice().label : "Desktop") + ".",
      options: () => EMULATION_DEVICES.map((d) => ({ label: d.label, checked: emulation.getState().device === d.id, run: () => emulation.setDevice(d.id) })),
      getActive: () => emulation.getState().device !== "desktop",
    },
    {
      label: "Screen Size", icon: "uigrid", size: "small",
      desc: () => "Resolucao emulada: " + emulation.getResolution().w + "x" + emulation.getResolution().h + ".",
      options: () => (emulation.getDevice() ? emulation.getDevice().sizes : []).map((s) => ({ label: s.label, checked: emulation.getState().sizeId === s.id, run: () => emulation.setScreenSize(s.id) })),
    },
    {
      label: "Orientation", icon: "transform", size: "small",
      desc: () => "Orientacao: " + (emulation.getState().orientation === "portrait" ? "Portrait" : "Landscape") + ".",
      options: () => [
        { label: "Landscape", checked: emulation.getState().orientation === "landscape", run: () => emulation.setOrientation("landscape") },
        { label: "Portrait", checked: emulation.getState().orientation === "portrait", run: () => emulation.setOrientation("portrait") },
      ],
    },
    { label: "Touch Enabled", icon: "cursor", size: "small", desc: "Converte cliques em TouchStarted/TouchEnded no viewport emulado.", onRun: () => emulation.setTouch(!emulation.isTouchEnabled()), getActive: () => emulation.isTouchEnabled() },
  ];

  const statsEntries = [
    { label: "Summary", icon: "text", size: "large", desc: "Painel Summary Stats: FPS, tempos, memoria e contagens.", onRun: () => toggleSummaryStats(), getActive: () => isSummaryStatsVisible() },
    { label: "MicroProfiler", icon: "find", size: "small", desc: "Grafico de CPU por categoria a cada frame (Ctrl+F6).", onRun: () => toggleMicroProfiler(), getActive: () => isMicroProfilerVisible() },
    { label: "Performance Stats", icon: "eye", size: "small", desc: "Overlay de performance no Viewport (mesma opcao da aba View).", onRun: () => store.setViewOption("perfStats", !store.getViewOption("perfStats")), getActive: () => !!store.getViewOption("perfStats") },
    { label: "Network Stats", icon: "layers", size: "small", desc: "Painel de metricas de rede por cliente.", onRun: () => toggleNetworkStats(), getActive: () => isNetworkStatsVisible() },
    { label: "Validation", icon: "check", size: "small", desc: "Validacao Mestre: checks de integridade de todos os sistemas (Ctrl+Alt+V).", onRun: () => toggleValidationPanel(), getActive: () => isValidationPanelVisible() },
  ];

  const optionsEntries = [
    {
      label: "FilteringEnabled", icon: "filter", size: "large",
      desc: "Modelo Server-Client (replicacao filtrada) durante o Playtest.",
      onRun: () => setNet("filteringEnabled", getNetworkSettings().filteringEnabled === false),
      getActive: () => getNetworkSettings().filteringEnabled !== false,
    },
    {
      label: "Latency", icon: "bug", size: "small",
      desc: () => { const ms = getNetworkSettings().latencyMs; return "Latencia simulada: " + (ms > 0 ? ms + "ms" : "Off") + ". Afeta Remotes em tempo real."; },
      options: () => LATENCY_OPTIONS.map((ms) => ({ label: ms === 0 ? "Off" : ms + "ms", checked: getNetworkSettings().latencyMs === ms, run: () => setNet("latencyMs", ms) })),
      getActive: () => getNetworkSettings().latencyMs > 0,
    },
    {
      label: "Packet Loss", icon: "selectionbox", size: "small",
      desc: () => "Perda de pacotes simulada: " + getNetworkSettings().packetLossPct + "%.",
      options: () => PACKET_LOSS_OPTIONS.map((pct) => ({ label: pct + "%", checked: getNetworkSettings().packetLossPct === pct, run: () => setNet("packetLossPct", pct) })),
      getActive: () => getNetworkSettings().packetLossPct > 0,
    },
  ];

  root.append(
    buildGroup("Playtest", playtestEntries),
    buildClientsGroup(),
    buildWalletGroup(),
    buildGroup("Emulation", emulationEntries),
    buildGroup("Stats", statsEntries),
    buildGroup("Options", optionsEntries),
  );

  function refresh() {
    for (const { btn, entry } of buttons) {
      if (entry.getActive) btn.classList.toggle("rsw-rtool--active", entry.getActive() === true);
    }
    if (playersInput && document.activeElement !== playersInput) {
      playersInput.value = String(multiClient.getPlayerCount());
    }
  }

  bus.on(RuntimeEvents.ModeChanged, refresh);
  bus.on(RuntimeEvents.PausedChanged, refresh);
  bus.on("multiclient:changed", refresh);
  bus.on("emulation:changed", refresh);
  bus.on("network:settingsChanged", refresh);

  refresh();
  return { el: root, refresh };
}
