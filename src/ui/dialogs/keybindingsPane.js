import { keybindings } from "../../core/keybindings.js";
import { bus } from "../../core/eventBus.js";
import { openConfirm, makeButton } from "../modal.js";
import { _el as el } from "./fields.js";
import { createIcon } from "../icons.js";

const ROW_HEIGHT = 34;
const OVERSCAN = 4;
const CATEGORIES = ["All", "File", "Edit", "Tools", "Viewport", "Playtest", "Debug", "Script Editor", "Panels"];

export function buildKeybindingsPane() {
  const root = el("div", "rsw-kb");

  const toolbar = el("div", "rsw-kb__toolbar");
  const search = document.createElement("input");
  search.type = "text";
  search.className = "rsw-kb__search";
  search.placeholder = "Search by action or key...";
  search.setAttribute("aria-label", "Search keybindings");
  const catSel = document.createElement("select");
  catSel.className = "rsw-kb__cats";
  catSel.setAttribute("aria-label", "Filter by category");
  for (const c of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    catSel.appendChild(opt);
  }
  const resetAllBtn = makeButton("Reset All to Defaults", "ghost", async () => {
    const ok = await openConfirm({
      title: "Reset all keybindings",
      message: "Restore every shortcut to its default key combination?",
      buttons: [
        { label: "Reset All", value: true, kind: "primary" },
        { label: "Cancel", value: false, kind: "default" },
      ],
    });
    if (ok === true) {
      keybindings.resetAllCustom();
      refresh();
    }
  });
  toolbar.append(search, catSel, resetAllBtn);

  const head = el("div", "rsw-kb__head");
  for (const c of ["Action Name", "Current Shortcut", "Default Shortcut", "Category", ""]) {
    head.appendChild(el("span", "", c));
  }

  const list = el("div", "rsw-kb__list");
  const sizer = el("div", "rsw-kb__sizer");
  list.appendChild(sizer);

  root.append(toolbar, head, list);

  let filtered = [];
  let capturingId = null;

  function matches(item, q) {
    if (!q) return true;
    const hay = (item.label + " " + item.id + " " + (item.combo || "") + " " + (item.defaultCombo || "")).toLowerCase();
    return hay.includes(q);
  }

  function computeFiltered() {
    const q = search.value.trim().toLowerCase();
    const cat = catSel.value;
    filtered = keybindings
      .list()
      .filter((i) => (cat === "All" || i.category === cat) && matches(i, q))
      .sort((a, b) =>
        a.category === b.category ? a.label.localeCompare(b.label) : a.category.localeCompare(b.category),
      );
  }

  function buildRow(item, index) {
    const row = el("div", "rsw-kb__row");
    row.style.top = index * ROW_HEIGHT + "px";
    row.appendChild(el("span", "rsw-kb__name", item.label));
    const combo = el("span", "rsw-kb__combo");
    if (capturingId === item.id) {
      combo.classList.add("is-capturing");
      combo.textContent = "Press key combination...";
    } else {
      combo.textContent = item.combo || "\u2014";
      if (item.customized) combo.classList.add("is-custom");
    }
    combo.title = "Double-click to change";
    combo.setAttribute("role", "button");
    combo.setAttribute("aria-label", "Change shortcut for " + item.label);
    combo.tabIndex = 0;
    combo.addEventListener("dblclick", () => startCapture(item));
    combo.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && capturingId !== item.id) {
        e.preventDefault();
        e.stopPropagation();
        startCapture(item);
      }
    });
    row.appendChild(combo);
    row.appendChild(el("span", "rsw-kb__default", item.defaultCombo || "\u2014"));
    row.appendChild(el("span", "rsw-kb__cat", item.category));
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "rsw-kb__reset";
    reset.replaceChildren(createIcon("refresh", 13));
    reset.title = "Reset to Default";
    reset.setAttribute("aria-label", "Reset " + item.label + " to default");
    reset.disabled = !item.customized;
    reset.style.visibility = item.customized ? "visible" : "hidden";
    reset.addEventListener("click", () => {
      keybindings.resetCustom(item.id);
      refresh();
    });
    row.appendChild(reset);
    return row;
  }

  function renderWindow() {
    sizer.style.height = Math.max(filtered.length * ROW_HEIGHT, 1) + "px";
    sizer.replaceChildren();
    if (!filtered.length) {
      sizer.style.height = "auto";
      sizer.appendChild(el("div", "rsw-kb__empty", "No keybindings match your search."));
      return;
    }
    const top = list.scrollTop;
    const vh = list.clientHeight || 320;
    const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(filtered.length, Math.ceil((top + vh) / ROW_HEIGHT) + OVERSCAN);
    for (let i = start; i < end; i++) {
      sizer.appendChild(buildRow(filtered[i], i));
    }
  }

  function refresh() {
    computeFiltered();
    renderWindow();
  }


  let captureGuardOn = false;
  function onCaptureGuardKey(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    keybindings.cancelCapture();
  }
  function addCaptureGuard() {
    if (captureGuardOn || typeof window === "undefined") return;
    window.addEventListener("keydown", onCaptureGuardKey, true);
    captureGuardOn = true;
  }
  function removeCaptureGuard() {
    if (!captureGuardOn) return;
    window.removeEventListener("keydown", onCaptureGuardKey, true);
    captureGuardOn = false;
  }

  function startCapture(item) {
    if (capturingId) keybindings.cancelCapture();
    capturingId = item.id;
    renderWindow();
    addCaptureGuard();
    keybindings.beginCapture((combo) => {
      removeCaptureGuard();
      capturingId = null;
      if (combo) applyCombo(item, combo);
      else refresh();
    });
  }

  async function applyCombo(item, combo) {
    const conflicts = keybindings.conflictsOf(combo, item.id);
    if (conflicts.length) {
      const names = conflicts.map((c) => '"' + c.label + '"').join(", ");
      const choice = await openConfirm({
        title: "Shortcut Conflict",
        message: combo + " is already used by " + names + '. Reassign it to "' + item.label + '"?',
        buttons: [
          { label: "Reassign", value: true, kind: "primary" },
          { label: "Cancel", value: false, kind: "default" },
        ],
      });
      if (choice !== true) {
        refresh();
        return;
      }
    }


    const res = keybindings.setCustom(item.id, combo);
    if (res.ok) {


      const stuck = [];
      for (const c of conflicts) {
        const r2 = keybindings.setCustom(c.id, null);
        if (!r2 || !r2.ok) stuck.push('"' + c.label + '"');
      }
      if (stuck.length) {
        await openConfirm({
          title: "Limit reached",
          message:
            "Customization limit reached: " + stuck.join(", ") +
            " could not be unbound and still use " + combo + ".",
          buttons: [{ label: "OK", value: true, kind: "primary" }],
        });
      }
    }
    if (!res.ok && res.error === "limit") {
      await openConfirm({
        title: "Limit reached",
        message: "You can customize at most 200 shortcuts.",
        buttons: [{ label: "OK", value: true, kind: "primary" }],
      });
    }
    refresh();
  }

  const offBus = bus.on("keybindings:changed", () => refresh());
  search.addEventListener("input", refresh);
  catSel.addEventListener("change", refresh);
  list.addEventListener("scroll", renderWindow);

  refresh();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(renderWindow);

  return {
    el: root,
    refresh,
    destroy() {
      if (typeof offBus === "function") offBus();
      if (capturingId) {
        keybindings.cancelCapture();
        capturingId = null;
      }
      removeCaptureGuard();
    },
  };
}
