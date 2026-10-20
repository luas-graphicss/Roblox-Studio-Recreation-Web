import { commandRegistry } from "../core/commandRegistry.js";
import { getPluginMenuSections } from "../plugins/pluginHost.js";            
import { createIcon } from "./icons.js";


const MENUS = [
  {
    id: "file",
    label: "File",
    access: "f",
    items: [
      { cmd: "file.new", shortcut: "Ctrl+N" },
      { cmd: "file.open", shortcut: "Ctrl+O" },
      { cmd: "file.openFromFile" },
      { cmd: "file.closePlace" },
      { sep: true },
      { cmd: "file.save", shortcut: "Ctrl+S" },
      { cmd: "file.saveAs", shortcut: "Ctrl+Shift+S" },
      { cmd: "file.saveToRoblox", shortcut: "Ctrl+P" },
      { cmd: "file.publishAs" },
      { cmd: "file.saveToCloud" },
      { sep: true },
      { cmd: "file.gameSettings" },
      { cmd: "file.studioSettings" },
      { sep: true },
      { cmd: "file.import" },
      { cmd: "file.insertFromFile" },
      { cmd: "file.exportSelection" },
      { cmd: "file.exportPlace" },
      { sep: true },
      { cmd: "file.importRoblox" },
      { cmd: "file.exportRbxlx" },
      { cmd: "file.exportRbxl" },
      { cmd: "file.exportSelectionRbxmx" },
      { cmd: "file.exportSelectionRbxm" },
      { sep: true },
      { cmd: "file.autoRecover" },
      { cmd: "file.versionHistory" },
      { cmd: "file.teamCreate", type: "check" },
      { cmd: "file.exit" },
    ],
  },
  {
    id: "edit",
    label: "Edit",
    access: "e",
    items: [
      { cmd: "edit.undo", shortcut: "Ctrl+Z" },
      { cmd: "edit.redo", shortcut: "Ctrl+Y" },
      { sep: true },
      { cmd: "edit.cut", shortcut: "Ctrl+X" },
      { cmd: "edit.copy", shortcut: "Ctrl+C" },
      { cmd: "edit.paste", shortcut: "Ctrl+V" },
      { cmd: "edit.duplicate", shortcut: "Ctrl+D" },
      { cmd: "edit.delete", shortcut: "Del" },
      { sep: true },
      { cmd: "edit.selectAll", shortcut: "Ctrl+A" },
    ],
  },
  {
    id: "view",
    label: "View",
    access: "v",
    items: [
      { cmd: "view.explorer", type: "check" },
      { cmd: "view.properties", type: "check" },
      { cmd: "view.output", type: "check" },
      { cmd: "view.apiBrowser", type: "check" },
      { sep: true },
      { cmd: "view.toolbox" },
      { cmd: "view.assetManager" },
      { cmd: "view.creatorDashboard" },
      { cmd: "view.packageManager" },
      { cmd: "view.commandBar", type: "check" },
      { cmd: "view.tagEditor", type: "check" },
      { cmd: "view.teamCreatePanel", type: "check" },
      { cmd: "view.draftsPanel", type: "check" },
      { cmd: "view.activityLog", type: "check" },
      { cmd: "view.colorGrading" },
      { sep: true },
      { cmd: "view.theme", type: "check" },
    ],
  },
  {
    id: "insert",
    label: "Insert",
    access: "i",
    items: [
      { cmd: "insert.part" },
      { cmd: "insert.sphere" },
      { cmd: "insert.cylinder" },
      { cmd: "insert.wedge" },
      { sep: true },
      { cmd: "insert.model" },
      { cmd: "insert.folder" },
      { cmd: "insert.script" },
      { sep: true },
      { cmd: "insert.tool" },
      { cmd: "insert.seat" },
      { cmd: "insert.vehicleseat" },
      { cmd: "insert.clickdetector" },
      { cmd: "insert.proximityprompt" },
    ],
  },
  {
    id: "format",
    label: "Format",
    access: "o",
    items: [
      { cmd: "format.group", shortcut: "Ctrl+G" },
      { cmd: "format.ungroup", shortcut: "Ctrl+U" },
      { sep: true },
      { cmd: "format.lock", shortcut: "L" },                                                                    
      { cmd: "format.anchor", type: "check" },
      { sep: true },
      { cmd: "format.alignLeft" },
      { cmd: "format.alignCenterH" },
      { cmd: "format.alignRight" },
      { cmd: "format.alignTop" },
      { cmd: "format.alignMiddle" },
      { cmd: "format.alignBottom" },
    ],
  },
  {
    id: "test",
    label: "Test",
    access: "t",
    items: [
      { cmd: "test.play", shortcut: "F5" },
      { cmd: "test.run", shortcut: "F8" },
      { cmd: "test.stop", shortcut: "Shift+F5" },
      { cmd: "test.pause", shortcut: "F7" },                                                                               
    ],
  },
  {
    id: "plugins",
    label: "Plugins",
    access: "p",
    dynamic: true,
    items: [],
  },
  {
    id: "help",
    label: "Help",
    access: "h",
    items: [
      { cmd: "help.about" },
      { cmd: "help.whatsNew" },
      { sep: true },
      { cmd: "help.apiReference", shortcut: "Ctrl+Shift+D" },
      { cmd: "help.shortcuts" },
      { cmd: "help.studioSettings" },
      { sep: true },
      { cmd: "help.reportBug" },
      { cmd: "help.tour" },
      { cmd: "help.checkUpdates" },
    ],
  },
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}


function labelWithAccel(label, access) {
  const frag = document.createDocumentFragment();
  const idx = access ? label.toLowerCase().indexOf(access.toLowerCase()) : -1;
  if (idx < 0) {
    frag.appendChild(document.createTextNode(label));
    return frag;
  }
  if (idx > 0) frag.appendChild(document.createTextNode(label.slice(0, idx)));
  const u = el("u", null, label.slice(idx, idx + 1));
  frag.appendChild(u);
  frag.appendChild(document.createTextNode(label.slice(idx + 1)));
  return frag;
}

export function buildMenuBar() {
  const bar = el("div", "rsw-menubar");
  bar.setAttribute("role", "menubar");
  bar.setAttribute("aria-label", "Barra de menus");


  let openMenu = null;                                           

  const buttons = new Map();                

  function closeMenu() {
    if (!openMenu) return;
    const { button, dropdown } = openMenu;
    if (dropdown && dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);                         
    button.setAttribute("aria-expanded", "false");
    button.classList.remove("is-open");
    openMenu = null;
    document.removeEventListener("mousedown", onDocDown, true);
  }

  function onDocDown(e) {
    if (!openMenu) return;
    if (openMenu.dropdown.contains(e.target) || openMenu.button.contains(e.target)) return;
    closeMenu();
  }


  function buildDropdown(def) {
    const dd = el("div", "rsw-menu");
    dd.setAttribute("role", "menu");
    const itemEls = [];
    if (def.dynamic) {
      buildPluginRows(dd, itemEls);
      return { dd, itemEls };
    }
    for (const item of def.items) {
      if (item.sep) {
        const s = el("div", "rsw-menu__sep");
        s.setAttribute("role", "separator");
        dd.appendChild(s);
        continue;
      }
      const cmd = item.cmd;
      const label = commandRegistry.get(cmd) ? commandRegistry.get(cmd).label : cmd;
      const enabled = commandRegistry.isEnabled(cmd);
      const checked = item.type === "check" && commandRegistry.isChecked(cmd);

      const row = el("button", "rsw-menu__item");
      row.type = "button";
      row.setAttribute("role", "menuitem");
      if (!enabled) {
        row.classList.add("is-disabled");
        row.setAttribute("aria-disabled", "true");
        row.disabled = true;
      }
      const check = el("span", "rsw-menu__check");
      if (checked) check.appendChild(createIcon("check", 12));
      const text = el("span", "rsw-menu__label", label);
      const sc = el("span", "rsw-menu__shortcut", item.shortcut || "");
      row.append(check, text, sc);
      if (enabled) {
        row.addEventListener("click", () => {
          closeMenu();
          commandRegistry.run(cmd);
        });
        row.addEventListener("mouseenter", () => {
          const i = itemEls.indexOf(row);
          if (i >= 0) setActive(i);
        });
      }
      itemEls.push(row);
      dd.appendChild(row);
    }
    return { dd, itemEls };
  }


  function buildPluginRows(dd, itemEls) {
    const sections = getPluginMenuSections();
    if (!sections.length) {
      const row = el("button", "rsw-menu__item is-disabled");
      row.type = "button";
      row.setAttribute("role", "menuitem");
      row.setAttribute("aria-disabled", "true");
      row.disabled = true;
      row.append(
        el("span", "rsw-menu__check", ""),
        el("span", "rsw-menu__label", "Nenhum menu de plugin"),
        el("span", "rsw-menu__shortcut", ""),
      );
      itemEls.push(row);
      dd.appendChild(row);
      return;
    }
    let first = true;
    for (const sec of sections) {
      if (!first) {
        const s2 = el("div", "rsw-menu__sep");
        s2.setAttribute("role", "separator");
        dd.appendChild(s2);
      }
      first = false;
      const head = el("button", "rsw-menu__item is-disabled");
      head.type = "button";
      head.setAttribute("role", "menuitem");
      head.setAttribute("aria-disabled", "true");
      head.disabled = true;
      head.append(
        el("span", "rsw-menu__check", ""),
        el("span", "rsw-menu__label", `${sec.name} \u2014 ${sec.pluginName}`),
        el("span", "rsw-menu__shortcut", ""),
      );
      itemEls.push(head);
      dd.appendChild(head);
      for (const item of sec.items) {
        const row = el("button", "rsw-menu__item");
        row.type = "button";
        row.setAttribute("role", "menuitem");
        row.append(
          el("span", "rsw-menu__check", ""),
          el("span", "rsw-menu__label", item.label),
          el("span", "rsw-menu__shortcut", ""),
        );
        row.addEventListener("click", () => {
          closeMenu();
          item.run();
        });
        row.addEventListener("mouseenter", () => {
          const i = itemEls.indexOf(row);
          if (i >= 0) setActive(i);
        });
        itemEls.push(row);
        dd.appendChild(row);
      }
    }
  }

  function setActive(i) {
    if (!openMenu) return;
    const list = openMenu.items;
    if (!list.length) return;
    const n = list.length;
    let idx = ((i % n) + n) % n;

    let guard = 0;
    while (list[idx].disabled && guard < n) {
      idx = (idx + 1) % n;
      guard++;
    }
    openMenu.index = idx;
    for (let k = 0; k < n; k++) list[k].classList.toggle("is-active", k === idx);
    const node = list[idx];
    if (node && typeof node.focus === "function") node.focus();
  }

  function openFor(def, button, focusFirst) {
    if (openMenu && openMenu.def === def) {
      closeMenu();
      return;
    }
    closeMenu();
    const { dd, itemEls } = buildDropdown(def);



    dd.addEventListener("keydown", onKeyDown);

    const r = button.getBoundingClientRect();
    dd.style.position = "fixed";
    dd.style.top = r.bottom + "px";
    dd.style.left = r.left + "px";
    document.body.appendChild(dd);
    button.setAttribute("aria-expanded", "true");
    button.classList.add("is-open");
    openMenu = { def, button, dropdown: dd, items: itemEls, index: -1 };
    document.addEventListener("mousedown", onDocDown, true);
    if (focusFirst) setActive(0);
  }


  function siblingMenu(dir) {
    if (!openMenu) return;
    const ids = MENUS.map((m) => m.id);
    const cur = ids.indexOf(openMenu.def.id);
    const next = (cur + dir + ids.length) % ids.length;
    const def = MENUS[next];
    const btn = buttons.get(def.id);
    openFor(def, btn, true);
  }


  function onKeyDown(e) {

    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key && e.key.length === 1) {
      const def = MENUS.find((m) => m.access === e.key.toLowerCase());
      if (def) {
        e.preventDefault();
        openFor(def, buttons.get(def.id), true);
        return;
      }
    }
    if (!openMenu) return;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        { const b = openMenu.button; closeMenu(); if (b) b.focus(); }
        break;
      case "ArrowDown":
        e.preventDefault();
        setActive(openMenu.index < 0 ? 0 : openMenu.index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive(openMenu.index < 0 ? openMenu.items.length - 1 : openMenu.index - 1);
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(openMenu.items.length - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        siblingMenu(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        siblingMenu(-1);
        break;
      case "Enter":
      case " ":
        if (openMenu.index >= 0) {
          e.preventDefault();
          openMenu.items[openMenu.index].click();
        }
        break;
      default:
        break;
    }
  }


  for (const def of MENUS) {
    const btn = el("button", "rsw-menubar__btn");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.appendChild(labelWithAccel(def.label, def.access));
    btn.addEventListener("click", () => openFor(def, btn, false));
    btn.addEventListener("mouseenter", () => {

      if (openMenu && openMenu.def !== def) openFor(def, btn, false);
    });
    buttons.set(def.id, btn);
    bar.appendChild(btn);
  }

  bar.addEventListener("keydown", onKeyDown);

  document.addEventListener("keydown", (e) => {


    if (e.defaultPrevented) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key && e.key.length === 1) {
      const def = MENUS.find((m) => m.access === e.key.toLowerCase());
      if (def) {
        e.preventDefault();
        openFor(def, buttons.get(def.id), true);
      }
    }
  });

  return bar;
}
