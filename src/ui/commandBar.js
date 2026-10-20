import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { createIcon } from "./icons.js";
import { engine } from "../runtime/engine.js";                           

const MAX_HISTORY = 100;
const KEYWORDS = ["game", "workspace", "script", "print", "warn", "error", "wait", "Instance.new", "pairs", "ipairs"];

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

export function buildCommandBar(parent) {
  if (!parent) throw new Error("CommandBar: parent ausente.");

  const bar = el("div", "rsw-cmdbar");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Command Bar");

  const prefix = el("span", "rsw-cmdbar__prefix");
  prefix.appendChild(createIcon("command", 14));
  const chevron = el("span", "rsw-cmdbar__chevron");
  chevron.textContent = ">";

  const input = el("input", "rsw-cmdbar__input");
  input.type = "text";
  input.placeholder = "Digite um comando…";
  input.setAttribute("aria-label", "Comando");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  input.setAttribute("list", "rsw-cmdbar-keywords");


  const datalist = el("datalist");
  datalist.id = "rsw-cmdbar-keywords";
  for (const kw of KEYWORDS) {
    const o = el("option");
    o.value = kw;
    datalist.appendChild(o);
  }

  const runBtn = el("button", "rsw-cmdbar__run");
  runBtn.type = "button";
  runBtn.textContent = "Run";
  runBtn.setAttribute("title", "Executar comando");

  bar.append(prefix, chevron, input, datalist, runBtn);
  parent.appendChild(bar);


  const history = [];
  let histIndex = -1;                                                    
  let draft = "";

  function runCommand(text) {
    const cmd = String(text || "").trim();
    if (!cmd) return;

    if (history[history.length - 1] !== cmd) {
      history.push(cmd);
      if (history.length > MAX_HISTORY) history.shift();
    }
    histIndex = -1;
    draft = "";


    logger.info(`> ${cmd}`, { source: "Command" });


    engine.execCommand(cmd);

    input.value = "";
  }

  function navigateHistory(dir) {
    if (!history.length) return;
    if (histIndex === -1) {
      draft = input.value;                           
      histIndex = history.length;
    }
    histIndex += dir;
    if (histIndex < 0) histIndex = 0;
    if (histIndex >= history.length) {
      histIndex = -1;
      input.value = draft;
      return;
    }
    input.value = history[histIndex];

    requestAnimationFrame(() => {
      try {
        input.setSelectionRange(input.value.length, input.value.length);
      } catch (_) {

      }
    });
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runCommand(input.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      navigateHistory(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      navigateHistory(1);
    }
  });
  runBtn.addEventListener("click", () => {
    runCommand(input.value);
    input.focus();
  });


  const offRunLast = bus.on("commandbar:runLast", () => {
    const last = history[history.length - 1];
    if (last) runCommand(last);
    else logger.warn("Nenhum comando no histórico para executar.", { source: "Command" });
  });


  function applyVisible(state) {
    const visible = !!state.commandBarVisible;
    bar.toggleAttribute("hidden", !visible);
    if (visible) {
      requestAnimationFrame(() => {
        try {
          input.focus();
        } catch (_) {

        }
      });
    }
  }
  applyVisible(store.getState());
  const offStore = store.subscribe((state, change) => {
    if (change && change.key === "commandBarVisible") applyVisible(state);
  });

  function destroy() {
    if (typeof offRunLast === "function") offRunLast();
    if (typeof offStore === "function") offStore();
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  }

  return { el: bar, destroy, _debug: { runCommand, navigateHistory, history, getInput: () => input } };
}
