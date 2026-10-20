import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import * as bpStore from "../debugger/breakpoints.js";
import { debuggerController } from "../debugger/controller.js";
import { childrenOf, MAX_CHILDREN } from "../debugger/inspect.js";

const SECTIONS = [
  { id: "callstack", label: "Call Stack" },
  { id: "locals", label: "Locals" },
  { id: "watch", label: "Watch" },
  { id: "breakpoints", label: "Breakpoints" },
];


let _activeSection = "callstack";
export function getActiveDebuggerSection() {
  return _activeSection;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function contextLabel(ctx) {
  const c = String(ctx || "").toLowerCase();
  return c === "client" ? "Client" : "Server";
}


function resolvePathInstance(path) {
  const dm = store.getDataModel();
  if (!dm || !path) return null;
  const segs = String(path).split(".");
  let cur = dm;

  let start = segs.length && (segs[0] === dm.name || segs[0] === "game") ? 1 : 0;
  for (let i = start; i < segs.length; i++) {
    const seg = segs[i];
    let next = null;
    for (const child of cur.getChildren()) {
      if (child.name === seg) { next = child; break; }
    }
    if (!next) return null;
    cur = next;
  }
  return cur === dm ? null : cur;
}

export function buildDebuggerPanel(refs) {
  const body = refs.body;
  body.classList.add("rsw-dbg");


  const tabbar = el("div", "rsw-dbg__tabs");
  const content = el("div", "rsw-dbg__content");
  body.append(tabbar, content);

  let active = "callstack";
  const tabEls = new Map();
  for (const s of SECTIONS) {
    const t = el("button", "rsw-dbg__tab", s.label);
    t.type = "button";
    t.addEventListener("click", () => {
      active = s.id;
      _activeSection = s.id;
      render();
      bus.emit("debugger:sectionChanged", { id: s.id });
    });
    tabbar.appendChild(t);
    tabEls.set(s.id, t);
  }
  const pendingBadge = el("span", "rsw-dbg__pending");
  pendingBadge.hidden = true;
  tabbar.appendChild(pendingBadge);


  bus.on("debugger:showSection", (p) => {
    const id = p && p.id;
    if (id && tabEls.has(id)) {
      active = id;
      _activeSection = id;
      render();
      bus.emit("debugger:sectionChanged", { id });
    }
  });

  function isVisible() {
    const P = store.getState().layout.panels;
    return !!P.debugger;
  }


  function buildValueRow(name, value, summary, opts) {
    const depth = opts.depth || 0;
    const bridge = opts.bridge || null;
    const ancestors = opts.ancestors || new Set();
    const row = el("div", "rsw-dbg__var");
    row.style.paddingLeft = `${8 + depth * 14}px`;
    const head = el("div", "rsw-dbg__var-head");
    row.appendChild(head);

    const twisty = el("span", "rsw-dbg__twisty");
    const expandable = summary && summary.expandable && depth < 10 && !opts.circular;
    twisty.textContent = expandable ? "\u25b8" : "";
    head.appendChild(twisty);

    head.appendChild(el("span", "rsw-dbg__var-name", String(name)));
    const valEl = el("span", "rsw-dbg__var-value", summary ? summary.display : "nil");
    if (opts.circular) valEl.classList.add("is-muted");
    head.appendChild(valEl);
    if (summary && summary.type) {
      head.appendChild(el("span", "rsw-dbg__var-type", summary.type));
    }


    if (summary && summary.truncatedString && summary.fullText) {
      valEl.classList.add("is-expandable-string");
      valEl.title = "Clique para expandir/recolher";
      let full = false;
      valEl.addEventListener("click", (e) => {
        e.stopPropagation();
        full = !full;
        valEl.textContent = full ? summary.fullText : summary.display;
      });
    }

    if (expandable) {
      let expanded = false;
      let kidsWrap = null;
      let shown = 0;
      const renderKids = () => {
        kidsWrap.textContent = "";
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(value);
        let result;
        try {
          result = childrenOf(value, { bridge, depth, limit: shown, ancestors: nextAncestors });
        } catch (e) {
          kidsWrap.appendChild(el("div", "rsw-dbg__var-error", "erro ao expandir"));
          return;
        }
        for (const c of result.children) {
          kidsWrap.appendChild(buildValueRow(c.name, c.value, c.summary, {
            depth: depth + 1,
            bridge,
            ancestors: nextAncestors,
            circular: !!(c.summary && c.summary.circular),
          }));
        }
        if (result.hasMore) {
          const more = el("button", "rsw-dbg__more", `Show more (${result.children.length} de ${result.total})`);
          more.type = "button";
          more.style.marginLeft = `${8 + (depth + 1) * 14}px`;
          more.addEventListener("click", (e) => {
            e.stopPropagation();
            shown = Math.min(shown + MAX_CHILDREN, result.total);
            renderKids();
          });
          kidsWrap.appendChild(more);
        }
      };
      head.addEventListener("click", () => {
        expanded = !expanded;
        twisty.textContent = expanded ? "\u25be" : "\u25b8";
        if (expanded) {
          if (!kidsWrap) {
            kidsWrap = el("div", "rsw-dbg__var-kids");
            row.appendChild(kidsWrap);
          }
          shown = MAX_CHILDREN;
          renderKids();
          kidsWrap.hidden = false;
        } else if (kidsWrap) {
          kidsWrap.hidden = true;
        }
      });
    }
    return row;
  }

  function emptyMsg(text) {
    return el("div", "rsw-dbg__empty", text);
  }


  function renderCallStack(root) {
    if (!debuggerController.isPaused()) {
      root.appendChild(emptyMsg("N\u00e3o pausado. O Call Stack aparece quando um breakpoint \u00e9 atingido."));
      return;
    }
    const frames = debuggerController.callStack();
    const selIdx = Math.min(debuggerController.selectedFrameIndex, Math.max(0, frames.length - 1));
    frames.forEach((fr, i) => {
      const row = el("div", "rsw-dbg__frame");
      if (i === selIdx) row.classList.add("is-current");
      if (fr.native) row.classList.add("is-native");
      row.appendChild(el("span", "rsw-dbg__ctx-badge", contextLabel(fr.context)));
      row.appendChild(el("span", "rsw-dbg__frame-name", fr.name || "anonymous"));
      row.appendChild(el("span", "rsw-dbg__frame-loc", `${fr.scriptName}:${fr.line}`));
      if (!fr.native) {
        row.addEventListener("click", () => debuggerController.selectFrame(i));
      }
      root.appendChild(row);
    });
    if (!frames.length) root.appendChild(emptyMsg("Pilha vazia."));
  }


  function renderLocals(root) {
    if (!debuggerController.isPaused()) {
      root.appendChild(emptyMsg("N\u00e3o pausado. As vari\u00e1veis aparecem quando a execu\u00e7\u00e3o pausa."));
      return;
    }
    const { locals, upvalues, bridge } = debuggerController.frameVariables();
    const mkSection = (title, list) => {
      root.appendChild(el("div", "rsw-dbg__section-title", title));
      if (!list.length) {
        root.appendChild(emptyMsg("(nenhuma)"));
        return;
      }
      for (const v of list) {
        root.appendChild(buildValueRow(v.name, v.value, v.summary, { depth: 0, bridge }));
      }
    };
    mkSection("Locals", locals);
    mkSection("Upvalues", upvalues);
  }


  function renderWatch(root) {
    const addRow = el("div", "rsw-dbg__watch-add");
    const input = el("input", "rsw-dbg__watch-input");
    input.type = "text";
    input.placeholder = "Adicionar express\u00e3o (ex.: player.Character.Humanoid.Health)";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.trim()) {
        debuggerController.addWatch(input.value);
        input.value = "";
      }
    });
    addRow.appendChild(input);
    root.appendChild(addRow);

    const bridge = debuggerController.currentBridge();
    for (const w of debuggerController.watches) {
      const row = el("div", "rsw-dbg__watch-row");
      row.tabIndex = 0;
      const exprEl = el("span", "rsw-dbg__watch-expr", w.expr);
      exprEl.title = "Duplo clique para editar";
      row.appendChild(exprEl);

      const res = w.result;
      if (res && res.error) {
        row.appendChild(el("span", "rsw-dbg__watch-error", res.error));
      } else if (res && res.summary) {
        if (res.sideEffects) {
          const warn = el("span", "rsw-dbg__watch-warn", "\u26a0");
          warn.title = "A express\u00e3o cont\u00e9m chamadas de fun\u00e7\u00e3o \u2014 pode causar efeitos colaterais ao ser avaliada.";
          row.appendChild(warn);
        }
        const valWrap = el("span", "rsw-dbg__watch-val");
        if (res.summary.expandable) {
          valWrap.appendChild(buildValueRow("=", res.value, res.summary, { depth: 0, bridge }));
        } else {
          valWrap.textContent = res.summary.display;
        }
        row.appendChild(valWrap);
        row.appendChild(el("span", "rsw-dbg__var-type", res.type || ""));
      } else {
        row.appendChild(el("span", "rsw-dbg__watch-val is-muted", debuggerController.isPaused() ? "\u2014" : "(avaliado ao pausar)"));
      }

      const remove = el("button", "rsw-dbg__watch-x", "\u00d7");
      remove.type = "button";
      remove.title = "Remover (Delete)";
      remove.addEventListener("click", () => debuggerController.removeWatch(w.id));
      row.appendChild(remove);


      exprEl.addEventListener("dblclick", () => {
        const edit = el("input", "rsw-dbg__watch-input");
        edit.type = "text";
        edit.value = w.expr;
        exprEl.replaceWith(edit);
        edit.focus();
        edit.select();
        const commit = () => {
          const v = edit.value.trim();
          if (v && v !== w.expr) debuggerController.editWatch(w.id, v);
          else render();
        };
        edit.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") render();
        });
        edit.addEventListener("blur", () => commit());
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Delete" && e.target === row) debuggerController.removeWatch(w.id);
      });
      root.appendChild(row);
    }
    if (!debuggerController.watches.length) {
      root.appendChild(emptyMsg("Nenhuma express\u00e3o observada."));
    }
  }


  function renderBreakpoints(root) {
    const header = el("div", "rsw-dbg__bp-actions");
    const mkBtn = (label, fn) => {
      const b = el("button", "rsw-dbg__btn", label);
      b.type = "button";
      b.addEventListener("click", fn);
      return b;
    };
    header.append(
      mkBtn("Enable All", () => bpStore.setAllEnabled(true)),
      mkBtn("Disable All", () => bpStore.setAllEnabled(false)),
      mkBtn("Remove All", () => bpStore.removeAll()),
    );
    root.appendChild(header);

    const all = bpStore.listAll();
    if (!all.length) {
      root.appendChild(emptyMsg("Nenhum breakpoint. Clique na margem do editor para adicionar."));
      return;
    }
    for (const bp of all) {
      const row = el("div", "rsw-dbg__bp-row");
      if (!bp.valid) row.classList.add("is-invalid");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!bp.enabled;
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => bpStore.updateBreakpoint(bp.path, bp.line, { enabled: cb.checked }));
      row.appendChild(cb);

      const segs = String(bp.path).split(".");
      const scriptName = segs[segs.length - 1] || bp.path;
      const label = el("span", "rsw-dbg__bp-label", `${scriptName}:${bp.line}`);
      label.title = bp.path;
      row.appendChild(label);
      if (bp.logMessage) {
        const tag = el("span", "rsw-dbg__bp-cond", `log: ${bp.logMessage}`);
        tag.classList.add("is-log");
        row.appendChild(tag);
      } else if (bp.condition) {
        row.appendChild(el("span", "rsw-dbg__bp-cond", `cond: ${bp.condition}`));
      }
      if (!bp.valid) row.appendChild(el("span", "rsw-dbg__bp-cond", "(linha n\u00e3o execut\u00e1vel)"));

      row.addEventListener("click", () => {
        const inst = resolvePathInstance(bp.path);
        if (inst) bus.emit("debugger:focusLine", { instance: inst, line: bp.line });
      });
      root.appendChild(row);
    }
  }


  function render() {
    for (const [id, t] of tabEls) t.classList.toggle("is-active", id === active);
    const pending = debuggerController.pendingCount();
    pendingBadge.hidden = pending <= 0;
    if (pending > 0) pendingBadge.textContent = `${pending} pausa(s) pendente(s)`;
    content.textContent = "";
    if (!isVisible()) return;                                             
    if (active === "callstack") renderCallStack(content);
    else if (active === "locals") renderLocals(content);
    else if (active === "watch") renderWatch(content);
    else renderBreakpoints(content);
  }


  bus.on("debugger:showSection", (p) => {
    if (p && p.section && tabEls.has(p.section)) active = p.section;
    render();
  });
  bus.on("debugger:stateChanged", () => render());
  bus.on("debugger:paused", () => render());
  bus.on("debugger:resumed", () => render());
  bus.on("debugger:watchesChanged", () => {
    if (active === "watch") render();
    else if (debuggerController.pendingCount() >= 0) render();
  });
  bus.on("debugger:breakpointsChanged", () => {
    if (active === "breakpoints") render();
  });
  store.subscribe((state, change) => {
    if (change && change.key === "layout") render();
  });

  render();
  return { render };
}
