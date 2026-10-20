import { getPlayerSettings } from "./playerSettings.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createPauseMenu(api) {
  const { root, t, notify } = api;

  const host = el("div", "rsw-cg__menu");
  host.hidden = true;

  const panel = el("div", "rsw-cg__menu-panel");
  const body = el("div", "rsw-cg__menu-body");
  const nav = el("div", "rsw-cg__menu-nav");
  const content = el("div", "rsw-cg__menu-content");
  body.append(nav, content);

  const foot = el("div", "rsw-cg__menu-foot");
  const resumeBtn = el("button", "rsw-cg__bigbtn", t("resume"));
  resumeBtn.type = "button";
  resumeBtn.addEventListener("click", () => close());
  const resetBtn = el("button", "rsw-cg__bigbtn", t("resetCharacter"));
  resetBtn.type = "button";
  resetBtn.addEventListener("click", () => {
    if (resetBtn.disabled) return;
    openConfirm(t("resetConfirm"), t("reset"), () => {
      close();
      api.onResetConfirmed();
    });
  });

  const leaveBtn = el("button", "rsw-cg__bigbtn rsw-cg__bigbtn--danger", t("leave"));
  leaveBtn.type = "button";
  leaveBtn.addEventListener("click", () => {
    openConfirm(t("leaveConfirm"), t("leave"), () => {
      close();
      api.onLeave();
    });
  });
  foot.append(resumeBtn, resetBtn, leaveBtn);

  panel.append(body, foot);
  host.appendChild(panel);
  host.addEventListener("mousedown", (e) => {
    if (e.target === host) close();
  });
  root.appendChild(host);


  const confirmWrap = el("div", "rsw-cg__confirm");
  confirmWrap.hidden = true;
  const confirmBox = el("div", "rsw-cg__confirm-box");
  const confirmTitle = el("div", "rsw-cg__confirm-title");
  const confirmBtns = el("div", "rsw-cg__confirm-btns");
  confirmBox.append(confirmTitle, confirmBtns);
  confirmWrap.appendChild(confirmBox);
  root.appendChild(confirmWrap);

  function openConfirm(title, okLabel, onOk) {
    confirmTitle.textContent = title;
    confirmBtns.replaceChildren();
    const ok = el("button", "rsw-cg__bigbtn rsw-cg__bigbtn--danger", okLabel);
    ok.type = "button";
    ok.addEventListener("click", () => { confirmWrap.hidden = true; onOk(); });
    const cancel = el("button", "rsw-cg__bigbtn", t("cancel"));
    cancel.type = "button";
    cancel.addEventListener("click", () => { confirmWrap.hidden = true; });
    confirmBtns.append(ok, cancel);
    confirmWrap.hidden = false;
  }


  const TABS = ["people", "settings", "report", "help"];
  let activeTab = "people";
  const tabButtons = new Map();
  for (const tab of TABS) {
    const b = el("button", "rsw-cg__menu-tab", t("tab_" + tab));
    b.type = "button";
    b.addEventListener("click", () => selectTab(tab));
    nav.appendChild(b);
    tabButtons.set(tab, b);
  }

  function selectTab(tab) {
    activeTab = tab;
    for (const [k, b] of tabButtons) b.classList.toggle("is-active", k === tab);
    content.replaceChildren();
    if (tab === "people") buildPeople();
    else if (tab === "settings") buildSettings();
    else if (tab === "report") buildReport();
    else buildHelp();
  }

  function buildPeople() {
    const players = api.getPlayers();
    if (!players.length) {
      content.appendChild(el("div", null, t("noPlayers")));
      return;
    }
    for (const pl of players) {
      const row = el("div", "rsw-cg__people-row");
      const avatar = el("span", "rsw-cg__avatar", (pl.name || "P").slice(0, 1).toUpperCase());
      const name = el("span", null, pl.name || "Player");
      name.style.flex = "1";
      const report = el("button", "rsw-cg__bigbtn", t("report"));
      report.type = "button";
      report.style.padding = "5px 12px";
      report.addEventListener("click", () => notify(t("reportThanks")));
      row.append(avatar, name, report);
      content.appendChild(row);
    }
  }

  function addRow(label, ctl) {
    const row = el("div", "rsw-cg__setrow");
    row.appendChild(el("span", "rsw-cg__setlabel", label));
    const wrap = el("span", "rsw-cg__setctl");
    for (const c of ctl) wrap.appendChild(c);
    row.appendChild(wrap);
    content.appendChild(row);
    return row;
  }

  function slider(min, max, step, value, onChange, format) {
    const input = el("input", "rsw-cg__range");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const out = el("span", "rsw-cg__value", format(value));
    input.addEventListener("input", () => {
      const v = Number(input.value);
      out.textContent = format(onChange(v));
    });
    return [input, out];
  }

  function dropdown(options, value, onChange) {
    const sel = el("select", "rsw-cg__select");
    for (const [val, label] of options) {
      const o = el("option", null, label);
      o.value = val;
      sel.appendChild(o);
    }
    sel.value = value;
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  function toggle(value, onChange) {
    const b = el("button", "rsw-cg__toggle" + (value ? " is-on" : ""));
    b.type = "button";
    b.addEventListener("click", () => {
      const on = !b.classList.contains("is-on");
      b.classList.toggle("is-on", onChange(on) === true);
    });
    return b;
  }

  function buildSettings() {
    const s = getPlayerSettings();
    const apply = api.applySetting;                                          

    addRow(t("volume"), slider(0, 10, 1, s.volume, (v) => apply("volume", v), (v) => String(Math.round(v))));
    addRow(t("cameraMode"), [dropdown(
      [["Classic", "Classic"], ["Follow", "Follow"]],
      s.cameraMode,
      (v) => apply("cameraMode", v),
    )]);
    addRow(t("movementMode"), [dropdown(
      [["Default", "Default"], ["ClickToMove", "Click to Move"]],
      s.movementMode,
      (v) => apply("movementMode", v),
    )]);
    addRow(t("shiftLock"), [toggle(s.shiftLockSwitch, (v) => apply("shiftLockSwitch", v) === true)]);
    addRow(t("sensitivity"), slider(0.2, 3, 0.1, s.sensitivity, (v) => apply("sensitivity", v), (v) => Number(v).toFixed(1)));
    addRow(t("graphics"), slider(0, 10, 1, s.graphicsQuality, (v) => apply("graphicsQuality", v), (v) => (v < 1 ? t("auto") : String(Math.round(v)))));
    addRow(t("fullscreen"), [toggle(s.fullscreen, (v) => apply("fullscreen", v) === true)]);
    addRow(t("perfStats"), [toggle(s.perfStats, (v) => apply("perfStats", v) === true)]);
  }

  function buildReport() {
    content.appendChild(el("div", null, t("reportDesc")));
    const btn = el("button", "rsw-cg__bigbtn", t("reportSend"));
    btn.type = "button";
    btn.style.marginTop = "12px";
    btn.addEventListener("click", () => {
      openConfirm(t("reportConfirm"), t("reportSend"), () => notify(t("reportThanks")));
    });
    content.appendChild(btn);
  }

  function buildHelp() {
    const controls = [
      ["W A S D", t("helpMove")],
      ["Space", t("helpJump")],
      [t("helpRmb"), t("helpCamera")],
      ["Scroll", t("helpZoom")],
      ["Shift", t("helpShiftLock")],
      ["Tab", t("helpPlayerList")],
      [".", t("helpEmotes")],
      ["/", t("helpChat")],
      ["Esc", t("helpMenu")],
      ["F9", t("helpConsole")],
    ];
    for (const [key, desc] of controls) {
      const row = el("div", "rsw-cg__help-row");
      row.appendChild(el("span", null, desc));
      row.appendChild(el("span", "rsw-cg__kbd", key));
      content.appendChild(row);
    }
  }

  function syncResetButton() {
    const state = api.getResetState();                                         
    resetBtn.disabled = state === "disabled";
    resetBtn.title = state === "disabled" ? t("resetDisabledTip") : "";
  }

  function open() {
    syncResetButton();
    host.classList.toggle("has-blur", api.blurAllowed());
    selectTab(activeTab);
    host.hidden = false;
  }

  function close() {
    host.hidden = true;
    confirmWrap.hidden = true;
    api.onClosed();
  }

  return {
    open,
    close,
    toggle() { host.hidden ? open() : close(); },
    isOpen: () => !host.hidden,

    syncResetButton,


    refreshSettings() {
      if (host.hidden || activeTab !== "settings") return;
      selectTab("settings");
    },
    destroy() {
      if (host.parentNode) host.parentNode.removeChild(host);
      if (confirmWrap.parentNode) confirmWrap.parentNode.removeChild(confirmWrap);
    },
  };
}
