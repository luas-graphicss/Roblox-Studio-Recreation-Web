import { bus } from "../core/eventBus.js";
import { createIcon } from "./icons.js";
import { isInlineSvgSource, parseSvgIconSafely } from "../plugins/svgIconSanitizer.js";
import { attachTooltip } from "./tooltip.js";
import { openInfo } from "./modal.js";
import { buildGroupEl } from "./ribbon.js";
import { openPluginManager } from "./pluginManagerDialog.js";
import { openPluginMarketplace } from "./pluginMarketplaceDialog.js";
import {
  getToolbarSections,
  getButtonState,
  pressToolbarButton,
  runSelectedScriptAsPlugin,
  getPluginsFolderInfo,
} from "../plugins/pluginHost.js";

const CLICK_COOLDOWN = 120;

function showPluginsFolder() {
  const info = getPluginsFolderInfo();
  const files = info.files.length
    ? info.files.map((f) => "\u2022 " + f).join("\n")
    : "(vazia \u2014 nenhum plugin instalado)";
  openInfo({
    title: "Plugins Folder",
    message:
      `Pasta local de plugins (simulada):\n${info.path}\n\nConte\u00fado:\n${files}`,
  });
}

function runScriptAction() {
  const res = runSelectedScriptAsPlugin();
  if (!res.ok) {
    openInfo({ title: "Run Script", message: res.error });
  }
}



function renderPluginIcon(icon, size) {
  const wrap = document.createElement("span");
  wrap.className = "rsw-ptool__icon";
  const s = typeof icon === "string" ? icon : "";
  if (/^[\w-]{1,32}$/.test(s)) {
    wrap.appendChild(createIcon(s, size));
    return wrap;
  }
  if (/^(https?:\/\/|data:image\/)/i.test(s)) {
    const img = document.createElement("img");
    img.src = s;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => {
      wrap.replaceChildren(createIcon("plugin", size));
    });
    wrap.appendChild(img);
    return wrap;
  }


  if (isInlineSvgSource(s)) {
    const sanitizedSvg = parseSvgIconSafely(s);
    if (sanitizedSvg) {
      sanitizedSvg.setAttribute("width", String(size));
      sanitizedSvg.setAttribute("height", String(size));
      sanitizedSvg.setAttribute("aria-hidden", "true");
      wrap.appendChild(document.importNode(sanitizedSvg, true));
      return wrap;
    }
  }
  wrap.appendChild(createIcon("plugin", size));
  return wrap;
}

function buildCustomToolbarsGroup(ctx) {
  const group = document.createElement("div");
  group.className = "rsw-rgroup";
  const tools = document.createElement("div");
  tools.className = "rsw-rgroup__tools rsw-pribbon";
  const title = document.createElement("div");
  title.className = "rsw-rgroup__title";
  title.textContent = "Custom Toolbars";
  group.append(tools, title);

  let tipDisposers = [];
  const btnEls = new Map();                                 

  function applyState(key) {
    const entry = btnEls.get(key);
    if (!entry) return;
    const st = getButtonState(key);
    if (!st) return;
    entry.el.classList.toggle("rsw-ptool--active", !!st.active);
    entry.el.classList.toggle("rsw-ptool--disabled", !st.enabled);
    entry.el.setAttribute("aria-disabled", st.enabled ? "false" : "true");
    if (st.icon !== entry.icon) {
      entry.icon = st.icon;
      const next = renderPluginIcon(st.icon, 16);
      entry.iconWrap.replaceWith(next);
      entry.iconWrap = next;
    }
    if (entry.label && typeof st.text === "string" && st.text !== entry.label.textContent) {
      entry.label.textContent = st.text;
    }
  }

  function buildButton(b) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "rsw-ptool";
    const iconWrap = renderPluginIcon(b.icon, 16);
    const label = document.createElement("span");
    label.className = "rsw-ptool__label";
    label.textContent = b.text;                             
    el.append(iconWrap, label);
    let lastClick = 0;
    el.addEventListener("click", () => {
      const now = Date.now();
      if (now - lastClick < CLICK_COOLDOWN) return;
      lastClick = now;
      pressToolbarButton(b.key);
    });
    tipDisposers.push(attachTooltip(el, { title: b.text, desc: b.tooltip || b.text }));
    btnEls.set(b.key, { el, iconWrap, icon: b.icon, label });
    applyState(b.key);
    return el;
  }

  function render() {
    for (const d of tipDisposers.splice(0)) {
      try {
        d();
      } catch (_) {

      }
    }
    btnEls.clear();
    tools.replaceChildren();
    const sections = getToolbarSections();
    if (!sections.length) {
      const empty = document.createElement("div");
      empty.className = "rsw-pribbon__empty";
      empty.textContent = "Plugins instalados adicionar\u00e3o bot\u00f5es aqui.";
      tools.appendChild(empty);
      return;
    }
    sections.forEach((section, i) => {
      if (i > 0) {
        const sep = document.createElement("div");
        sep.className = "rsw-pribbon__sep";
        tools.appendChild(sep);
      }
      const plug = document.createElement("div");
      plug.className = "rsw-pribbon__plug";
      for (const tb of section.toolbars) {
        if (!tb.buttons.length) continue;
        const tbEl = document.createElement("div");
        tbEl.className = "rsw-pribbon__toolbar";
        const btns = document.createElement("div");
        btns.className = "rsw-pribbon__btns";
        for (const b of tb.buttons) btns.appendChild(buildButton(b));
        const tbName = document.createElement("div");
        tbName.className = "rsw-pribbon__tbname";
        tbName.textContent = tb.name;
        tbEl.append(btns, tbName);
        plug.appendChild(tbEl);
      }
      tools.appendChild(plug);
    });
  }

  ctx.disposers.push(bus.on("plugins:toolbars-changed", render));
  ctx.disposers.push(bus.on("plugins:changed", render));
  ctx.disposers.push(
    bus.on("plugins:button-state", (p) => {
      if (p && p.key) applyState(p.key);
    }),
  );
  render();
  return group;
}

export function buildRibbonPlugins() {
  const ctx = { entries: [], disposers: [], customUpdaters: [] };
  const root = document.createElement("div");
  root.className = "rsw-ribbon";
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Plugins");

  const groupPlugins = buildGroupEl(
    {
      title: "Plugins",
      tools: [
        {
          id: "manage-plugins",
          label: "Manage Plugins",
          icon: "plugin",
          size: "large",
          desc: "Abre o Plugin Manager para ativar, desativar e desinstalar plugins",
          onRun: () => openPluginManager(),
        },
        {
          id: "plugin-marketplace",
          label: "Plugin Marketplace",
          icon: "find",
          size: "large",
          desc: "Abre a loja simulada de plugins para instalar novos plugins",
          onRun: () => openPluginMarketplace(),
        },
        {
          id: "plugins-folder",
          label: "Folder",
          icon: "folder",
          size: "small",
          desc: "Abre a pasta local de plugins (simulado)",
          onRun: showPluginsFolder,
        },
      ],
    },
    ctx,
  );

  const groupCustom = buildCustomToolbarsGroup(ctx);

  const groupActions = buildGroupEl(
    {
      title: "Actions",
      tools: [
        {
          id: "run-script",
          label: "Run Script",
          icon: "run",
          size: "large",
          desc: "Executa o script selecionado como plugin tempor\u00e1rio (simulado)",
          onRun: runScriptAction,
        },
        {
          id: "open-plugins-folder",
          label: "Open Plugins Folder",
          icon: "folder",
          size: "small",
          desc: "Abre refer\u00eancia \u00e0 pasta local de plugins (simulado)",
          onRun: showPluginsFolder,
        },
      ],
    },
    ctx,
  );

  const sep1 = document.createElement("div");
  sep1.className = "rsw-rsep";
  const sep2 = document.createElement("div");
  sep2.className = "rsw-rsep";
  root.append(groupPlugins, sep1, groupCustom, sep2, groupActions);

  return {
    el: root,
    refresh() {
      for (const fn of ctx.customUpdaters) fn();
    },
    destroy() {
      for (const d of ctx.disposers.splice(0)) {
        try {
          d();
        } catch (_) {

        }
      }
    },
  };
}
