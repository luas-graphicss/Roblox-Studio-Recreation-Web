import { openModal, makeButton } from "../modal.js";
import { createIcon } from "../icons.js";
import { settings, SETTINGS_DEFAULTS, TERRAIN_IMPORT_MAX_VOXELS_RANGE } from "../../config/settings.js";                                                        
import { theme } from "../../theme/theme.js";
import { logger } from "../../core/logger.js";
import { setStatus } from "../../core/project.js";
import { keybindings } from "../../core/keybindings.js";
import { buildKeybindingsPane } from "./keybindingsPane.js";
import { openEraseLocalDataDialog } from "./eraseLocalDataCommand.js";           
import {
  field,
  selectInput,
  numberInput,
  checkboxField,
  sectionTitle,
  slider,
  textInput,
  textArea,
  _el as el,
} from "./fields.js";
import { AI_PROVIDERS, providerInfo, getApiKey, setApiKey } from "../../ai/aiConfig.js";            
import { luauRuntimeInfo } from "../../runtime/lua/runtimeSelector.js";                                      

const TABS = [
  { id: "general", label: "General", icon: "settings" },
  { id: "rendering", label: "Rendering", icon: "display" },
  { id: "scriptEditor", label: "Script Editor", icon: "script" },
  { id: "keybindings", label: "Keybindings", icon: "keyboard" },
  { id: "camera", label: "Camera", icon: "camera" },
  { id: "physics", label: "Physics", icon: "physics" },
  { id: "ai", label: "AI", icon: "assistant" },
];

const TAB_KEYS = {
  general: ["language", "tooltipsEnabled", "autosave", "autosaveIntervalMin", "persistRobuxBalance", "loadingScreenMinSec", "terrainImportMaxVoxels"],
  rendering: ["renderQuality", "gridVisible", "gridSize", "showAxisIndicator"],
  scriptEditor: ["editorFontSize", "editorTabSize", "editorWordWrap", "editorLineNumbers", "editorMinimap", "editorTheme", "editorCodeAssist", "luauTypeChecking", "luauStrictByDefault"],
  keybindings: [],
  camera: ["cameraSpeed", "cameraSensitivity", "cameraSmoothing", "cameraInvertY"],
  physics: ["physicsShowContacts", "physicsShowJoints", "physicsShowWireframe", "physicsShowVelocities", "physicsShowCenterOfMass", "physicsThrottle"],
  ai: ["aiEnabled", "aiProvider", "aiEndpoint", "aiModel", "aiMaxTokens", "aiTemperature", "aiSystemPrompt", "aiSendContext", "aiRateLimit"],
};

let _open = false;

export function openStudioSettings(initialTab) {
  if (_open) return null;
  _open = true;

  const requested = initialTab === "shortcuts" ? "keybindings" : initialTab;
  const startTab = requested && TABS.some((t) => t.id === requested) ? requested : "general";

  const layout = el("div", "rsw-gs");
  const side = el("div", "rsw-gs__side");
  side.setAttribute("role", "tablist");
  side.setAttribute("aria-label", "Studio Settings tabs");
  const content = el("div", "rsw-gs__content");
  layout.append(side, content);

  const panes = {};
  const tabBtns = {};
  let activeTab = null;
  let kbPane = null;
  let handle = null;

  function destroyKbPane() {
    if (kbPane) {
      kbPane.destroy();
      kbPane = null;
    }
  }

  function tabResetRow(id, pane) {
    const wrap = el("div", "rsw-gs__tabreset");
    wrap.appendChild(
      makeButton("Reset Tab to Defaults", "ghost", () => {
        for (const key of TAB_KEYS[id] || []) {
          settings.set(key, SETTINGS_DEFAULTS[key]);
        }
        if (id === "general") theme.set("dark");
        fillPane(id, pane);
        setStatus("Settings restored to defaults");
      }),
    );
    return wrap;
  }

  function buildGeneral(pane) {
    pane.appendChild(sectionTitle("Appearance"));
    pane.appendChild(
      field("Theme", selectInput(theme.get(), [
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" },
      ], (v) => theme.set(v === "light" ? "light" : "dark"))),
    );
    pane.appendChild(
      field("Editor Language", selectInput(settings.get("language"), [
        { value: "pt-BR", label: "Portugu\u00eas (Brasil)" },
        { value: "en-US", label: "English (US)" },
      ], (v) => settings.set("language", v))),
    );
    pane.appendChild(checkboxField("Show tooltips", settings.get("tooltipsEnabled") !== false, (c) => settings.set("tooltipsEnabled", c)));
    pane.appendChild(sectionTitle("Auto-Save"));
    pane.appendChild(checkboxField("Enable Auto-Save", settings.get("autosave") !== false, (c) => settings.set("autosave", c)));
    pane.appendChild(field("Auto-Save interval (minutes)", numberInput(settings.get("autosaveIntervalMin"), (n) => settings.set("autosaveIntervalMin", n), { min: 1, max: 60, step: 1 })));
    pane.appendChild(sectionTitle("Playtest"));
    pane.appendChild(checkboxField("Persist Robux Balance Between Playtests", settings.get("persistRobuxBalance") === true, (c) => settings.set("persistRobuxBalance", c)));

    pane.appendChild(field("Loading screen minimum (seconds)", numberInput(settings.get("loadingScreenMinSec"), (n) => settings.set("loadingScreenMinSec", n), { min: 0, max: 10, step: 0.5 })));

    pane.appendChild(sectionTitle("Terrain Import (.rbxl/.rbxlx)"));
    pane.appendChild(field("Import budget (max voxels)", numberInput(settings.get("terrainImportMaxVoxels"), (n) => settings.set("terrainImportMaxVoxels", n), { min: TERRAIN_IMPORT_MAX_VOXELS_RANGE.min, max: TERRAIN_IMPORT_MAX_VOXELS_RANGE.max, step: 100000 })));
    pane.appendChild(el("p", "rsw-field__hint",
      "Teto de voxels aceitos ao importar terreno SmoothGrid. Acima do teto o import vira PARCIAL (Parte 153): entra um subconjunto priorizado por densidade/proximidade da origem e o Output recebe o relatório. Vale a partir do próximo import. Padrão: 40.000.000."));


    pane.appendChild(sectionTitle("Local Data"));
    pane.appendChild(el("p", "rsw-field__hint",
      "Projects, versions, packages, cloud assets, DataStore entries and AI API keys are stored in this browser in clear text. On a shared or borrowed machine, erase them before you leave."));
    const eraseLocalDataRow = el("div", "rsw-gs__tabreset");
    eraseLocalDataRow.appendChild(
      makeButton("Erase All Local Data", "ghost", () => {
        openEraseLocalDataDialog();
      }),
    );
    pane.appendChild(eraseLocalDataRow);
  }

  function buildRendering(pane) {
    pane.appendChild(sectionTitle("Quality"));
    pane.appendChild(
      field("Render Quality", selectInput(settings.get("renderQuality") || "auto", [
        { value: "auto", label: "Automatic" },
        { value: "high", label: "High" },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ], (v) => settings.set("renderQuality", v))),
    );
    pane.appendChild(sectionTitle("Helpers"));
    pane.appendChild(checkboxField("Show grid", settings.get("gridVisible") !== false, (c) => settings.set("gridVisible", c)));
    pane.appendChild(field("Grid size (studs)", numberInput(settings.get("gridSize"), (n) => settings.set("gridSize", n), { min: 1, max: 64, step: 1 })));
    pane.appendChild(checkboxField("Show axis indicator", settings.get("showAxisIndicator") !== false, (c) => settings.set("showAxisIndicator", c)));
  }

  function buildScriptEditorPane(pane) {
    pane.appendChild(sectionTitle("Text"));
    pane.appendChild(field("Font size", numberInput(settings.get("editorFontSize"), (n) => settings.set("editorFontSize", n), { min: 8, max: 40, step: 1 })));
    pane.appendChild(field("Tab size", numberInput(settings.get("editorTabSize"), (n) => settings.set("editorTabSize", n), { min: 1, max: 8, step: 1 })));
    pane.appendChild(checkboxField("Word wrap", settings.get("editorWordWrap") !== false, (c) => settings.set("editorWordWrap", c)));
    pane.appendChild(checkboxField("Show line numbers", settings.get("editorLineNumbers") !== false, (c) => settings.set("editorLineNumbers", c)));
    pane.appendChild(checkboxField("Show minimap", settings.get("editorMinimap") !== false, (c) => settings.set("editorMinimap", c)));
    pane.appendChild(sectionTitle("Code Assist"));
    pane.appendChild(checkboxField("Enable Code Assist", settings.get("editorCodeAssist") !== false, (c) => settings.set("editorCodeAssist", c)));

    pane.appendChild(sectionTitle("Checagem de Tipos (Luau)"));
    pane.appendChild(checkboxField("Ativar checagem de tipos (LUA017\u2013LUA025)", settings.get("luauTypeChecking") !== false, (c) => settings.set("luauTypeChecking", c)));
    pane.appendChild(el("p", "rsw-field__hint",
      "Verifica anota\u00e7\u00f5es de tipo e os modos --!strict / --!nonstrict / --!nocheck dos scripts. " +
      "Desligar zera apenas os diagn\u00f3sticos de tipo (LUA017\u2013LUA025); LUA001\u2013LUA016 continuam ativos."));
    pane.appendChild(checkboxField("--!strict por padr\u00e3o", settings.get("luauStrictByDefault") === true, (c) => settings.set("luauStrictByDefault", c)));
    pane.appendChild(el("p", "rsw-field__hint",
      "Analisa scripts sem diretiva de modo como --!strict (checagem mais rigorosa)."));
    pane.appendChild(sectionTitle("Luau Engine"));



    const rt = luauRuntimeInfo();
    pane.appendChild(el("p", "rsw-field__hint",
      rt.wasmReady
        ? (rt.wasmDebug
          ? "Luau VM oficial (WASM) \u2014 engine \u00fanica de scripts, 100% da linguagem Luau, com breakpoints nativos do Debugger."
          : "Luau VM oficial (WASM) \u2014 engine \u00fanica de scripts, 100% da linguagem Luau. Esta build n\u00e3o exp\u00f5e a API de debug: recompile o .wasm (tools/luau-wasm/build.cmd) para breakpoints.")
        : "Luau VM (WASM) indispon\u00edvel" + (rt.wasmError ? " (" + rt.wasmError + ")" : "") + " \u2014 Play/Run n\u00e3o iniciam sem a VM (engine \u00fanica). Recarregue a p\u00e1gina; se persistir, verifique os assets em assets/luau/."));
    pane.appendChild(sectionTitle("Theme"));
    pane.appendChild(
      field("Editor theme", selectInput(settings.get("editorTheme") || "auto", [
        { value: "auto", label: "Match Studio theme" },
        { value: "dark", label: "Dark" },
        { value: "light", label: "Light" },
      ], (v) => settings.set("editorTheme", v))),
    );
  }

  function buildKeybindings(pane) {
    pane.classList.add("rsw-gs__pane--kb");
    kbPane = buildKeybindingsPane();
    pane.appendChild(kbPane.el);
  }

  function buildCamera(pane) {
    pane.appendChild(sectionTitle("Movement"));
    pane.appendChild(field("Camera speed", slider(settings.get("cameraSpeed"), (n) => settings.set("cameraSpeed", n), { min: 0.1, max: 10, step: 0.1 })));
    pane.appendChild(field("Sensitivity", slider(settings.get("cameraSensitivity"), (n) => settings.set("cameraSensitivity", n), { min: 0.1, max: 5, step: 0.1 })));
    pane.appendChild(sectionTitle("Behavior"));
    pane.appendChild(checkboxField("Camera smoothing", settings.get("cameraSmoothing") !== false, (c) => settings.set("cameraSmoothing", c)));
    pane.appendChild(checkboxField("Invert Y axis", settings.get("cameraInvertY") === true, (c) => settings.set("cameraInvertY", c)));
  }

  function buildPhysics(pane) {
    pane.appendChild(sectionTitle("Debug Visualization"));
    pane.appendChild(checkboxField("Show contact points", settings.get("physicsShowContacts") === true, (c) => settings.set("physicsShowContacts", c)));
    pane.appendChild(checkboxField("Show joint indicators", settings.get("physicsShowJoints") === true, (c) => settings.set("physicsShowJoints", c)));
    pane.appendChild(checkboxField("Show wireframe", settings.get("physicsShowWireframe") === true, (c) => settings.set("physicsShowWireframe", c)));
    pane.appendChild(checkboxField("Show velocities", settings.get("physicsShowVelocities") === true, (c) => settings.set("physicsShowVelocities", c)));
    pane.appendChild(checkboxField("Show center of mass", settings.get("physicsShowCenterOfMass") === true, (c) => settings.set("physicsShowCenterOfMass", c)));
    pane.appendChild(sectionTitle("Performance"));
    pane.appendChild(field("Physics throttle (%)", slider(settings.get("physicsThrottle"), (n) => settings.set("physicsThrottle", n), { min: 10, max: 100, step: 5 })));
  }

  function buildAI(pane) {
    const provider = providerInfo(settings.get("aiProvider"));
    pane.appendChild(sectionTitle("AI Features"));
    pane.appendChild(checkboxField("Enable AI Features", settings.get("aiEnabled") === true, (c) => settings.set("aiEnabled", c)));
    pane.appendChild(sectionTitle("Provider"));
    pane.appendChild(
      field("Provider", selectInput(provider.id, Object.values(AI_PROVIDERS).map((p) => ({ value: p.id, label: p.label })), (v) => {
        settings.set("aiProvider", v);
        settings.set("aiModel", "");
        settings.set("aiEndpoint", "");
        fillPane("ai", pane);
      })),
    );
    const keyInput = textInput(getApiKey(), (v) => setApiKey(v), { placeholder: provider.needsKey ? "Obrigat\u00f3ria para este provider" : "Opcional", maxLength: 300 });
    keyInput.type = "password";
    keyInput.autocomplete = "new-password";
    pane.appendChild(field("API Key", keyInput, { hint: "Guardada apenas neste navegador (localStorage); nunca entra no arquivo do projeto." }));
    if (provider.id === "custom" || provider.id === "ollama") {
      pane.appendChild(field("Endpoint URL", textInput(settings.get("aiEndpoint"), (v) => settings.set("aiEndpoint", v), { placeholder: provider.endpoint || "https://exemplo.com/v1/chat/completions", maxLength: 512 })));
    }
    const modelValue = String(settings.get("aiModel") || "");
    if (provider.id === "custom") {
      pane.appendChild(field("Model", textInput(modelValue, (v) => settings.set("aiModel", v), { placeholder: "nome-do-modelo", maxLength: 128 })));
    } else {
      pane.appendChild(field("Model", selectInput(modelValue || provider.models[0], provider.models.map((m) => ({ value: m, label: m })), (v) => settings.set("aiModel", v))));
    }
    pane.appendChild(sectionTitle("Generation"));
    pane.appendChild(field("Max Tokens", numberInput(settings.get("aiMaxTokens"), (n) => settings.set("aiMaxTokens", n), { min: 64, max: 8192, step: 64 })));
    pane.appendChild(field("Temperature", slider(settings.get("aiTemperature"), (n) => settings.set("aiTemperature", n), { min: 0, max: 1, step: 0.05 })));
    pane.appendChild(field("System Prompt", textArea(settings.get("aiSystemPrompt"), (v) => settings.set("aiSystemPrompt", v), { rows: 6, maxLength: 8000, placeholder: "Vazio usa o prompt padr\u00e3o do Studio" })));
    pane.appendChild(sectionTitle("Context & Limits"));
    pane.appendChild(checkboxField("Send Project Context", settings.get("aiSendContext") !== false, (c) => settings.set("aiSendContext", c)));
    pane.appendChild(field("Rate limit (requests per minute)", numberInput(settings.get("aiRateLimit"), (n) => settings.set("aiRateLimit", n), { min: 1, max: 120, step: 1 })));
  }

  function fillPane(id, pane) {
    if (id === "keybindings") destroyKbPane();
    pane.replaceChildren();
    if (id === "general") buildGeneral(pane);
    else if (id === "rendering") buildRendering(pane);
    else if (id === "scriptEditor") buildScriptEditorPane(pane);
    else if (id === "keybindings") buildKeybindings(pane);
    else if (id === "camera") buildCamera(pane);
    else if (id === "physics") buildPhysics(pane);
    else if (id === "ai") buildAI(pane);
    if (id !== "keybindings") pane.appendChild(tabResetRow(id, pane));
  }

  function showTab(id) {
    if (activeTab === id) return;
    activeTab = id;
    for (const t of TABS) {
      const btn = tabBtns[t.id];
      const on = t.id === id;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      panes[t.id].style.display = on ? "" : "none";
    }
    if (!panes[id].dataset.built) {
      panes[id].dataset.built = "1";
      fillPane(id, panes[id]);
    } else if (id === "keybindings" && kbPane) {
      kbPane.refresh();
    }
  }

  for (const t of TABS) {
    const btn = el("button", "rsw-gs__tab");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", "false");
    const icon = el("span", "rsw-gs__tabicon");
    icon.appendChild(createIcon(t.icon, 16));
    icon.setAttribute("aria-hidden", "true");
    btn.append(icon, el("span", "rsw-gs__tablabel", t.label));
    btn.addEventListener("click", () => showTab(t.id));
    side.appendChild(btn);
    tabBtns[t.id] = btn;
    const pane = el("div", "rsw-gs__pane");
    pane.style.display = "none";
    content.appendChild(pane);
    panes[t.id] = pane;
  }

  const foot = el("div", "rsw-modal__btnrow rsw-modal__btnrow--split");
  const footLeft = el("div", "rsw-modal__btnrow-left");
  const footRight = el("div", "rsw-modal__btnrow-right");
  foot.append(footLeft, footRight);

  footLeft.appendChild(
    makeButton("Reset All to Defaults", "ghost", () => {
      try {
        settings.reset();
        theme.set("dark");
        keybindings.resetAllCustom();
      } catch (e) {
        logger.warn("StudioSettings: reset failed: " + (e && e.message));
      }
      for (const t of TABS) {
        if (panes[t.id].dataset.built) fillPane(t.id, panes[t.id]);
      }
      setStatus("All settings restored to defaults");
    }),
  );
  footRight.appendChild(
    makeButton("Close", "primary", () => {
      if (handle) handle.close({ reason: "done" });
    }),
  );

  handle = openModal({
    title: "Studio Settings",
    body: layout,
    footer: foot,
    width: 760,
    className: "rsw-modal--gs",
    closeOnBackdrop: false,
    onClose: () => {
      _open = false;
      destroyKbPane();
    },
  });

  showTab(startTab);
  return handle;
}
