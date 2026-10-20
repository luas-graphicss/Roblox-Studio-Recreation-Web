import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { openContextMenu } from "../ui/contextMenu.js";
import { openPrompt } from "../ui/modal.js";
import { LUAU_LANGUAGE_ID } from "./luauLang.js";
import * as bpStore from "../debugger/breakpoints.js";
import { debuggerController } from "../debugger/controller.js";
import { summarize, typeOf, childrenOf } from "../debugger/inspect.js";

const REVALIDATE_DEBOUNCE = 400;                                        


const recs = new Map();


let pausedMark = null;

let monacoRef = null;
let busWired = false;

function pathFor(rec) {
  const inst = rec.getInstance ? rec.getInstance() : null;
  if (!inst || (inst.isDestroyed && inst.isDestroyed())) return rec.lastPath || null;
  const p = bpStore.instancePath(inst);
  rec.lastPath = p;
  return p;
}

function glyphClassFor(bp) {
  let cls = "rsw-bp-glyph";
  if (!bp.valid) cls += " rsw-bp-glyph--invalid";
  else if (bp.logMessage) cls += " rsw-bp-glyph--logpoint";
  else if (bp.condition) cls += " rsw-bp-glyph--conditional";
  if (!bp.enabled) cls += " rsw-bp-glyph--disabled";
  return cls;
}

function bpHoverText(bp) {
  const parts = [];
  if (!bp.valid) parts.push("Breakpoint inv\u00e1lido (linha n\u00e3o execut\u00e1vel)");
  else if (bp.logMessage) parts.push(`Logpoint: ${bp.logMessage}`);
  else if (bp.condition) parts.push(`Breakpoint condicional: ${bp.condition}`);
  else parts.push("Breakpoint");
  if (!bp.enabled) parts.push("(desativado)");
  return parts.join(" ");
}


function renderDecorations(rec) {
  const model = rec.model;
  if (!model || model.isDisposed && model.isDisposed()) return;
  const path = pathFor(rec);
  const decos = [];
  rec.decoEntries = [];
  const lineCount = model.getLineCount();
  if (path) {
    for (const bp of bpStore.listForPath(path)) {
      if (bp.line < 1 || bp.line > lineCount) continue;
      decos.push({
        range: new monacoRef.Range(bp.line, 1, bp.line, 1),
        options: {
          glyphMarginClassName: glyphClassFor(bp),
          glyphMarginHoverMessage: { value: bpHoverText(bp) },
          stickiness: monacoRef.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
      rec.decoEntries.push({ line: bp.line });
    }
  }

  if (pausedMark && path && pausedMark.path === path && pausedMark.line >= 1 && pausedMark.line <= lineCount) {
    decos.push({
      range: new monacoRef.Range(pausedMark.line, 1, pausedMark.line, 1),
      options: {
        isWholeLine: true,
        className: "rsw-debug-line",
        glyphMarginClassName: "rsw-debug-arrow",
        stickiness: monacoRef.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    });
    rec.decoEntries.push({ line: pausedMark.line, isPauseLine: true });
  }
  rec.decoIds = model.deltaDecorations(rec.decoIds || [], decos);
}

function renderAll() {
  for (const rec of recs.values()) renderDecorations(rec);
}


function syncAfterEdit(rec) {
  const model = rec.model;
  const path = pathFor(rec);
  if (!path || !rec.decoIds) return;
  const entries = rec.decoEntries || [];
  const moves = [];
  for (let i = 0; i < rec.decoIds.length; i++) {
    const entry = entries[i];
    if (!entry || entry.isPauseLine) continue;
    const range = model.getDecorationRange(rec.decoIds[i]);
    if (!range) continue;
    if (range.startLineNumber !== entry.line) {
      moves.push({ from: entry.line, to: range.startLineNumber });
    }
  }
  if (moves.length) {
    rec.syncing = true;
    try {


      bpStore.moveBreakpoints(path, moves);
    } finally {
      rec.syncing = false;
    }
  }

  if (rec.revalidateTimer) clearTimeout(rec.revalidateTimer);
  rec.revalidateTimer = setTimeout(() => {
    rec.revalidateTimer = 0;
    const p = pathFor(rec);
    if (p) bpStore.revalidate(p, model.getValue());
  }, REVALIDATE_DEBOUNCE);
}


function toggleBreakpoint(rec, line) {
  const model = rec.model;
  const path = pathFor(rec);
  if (!path) return;

  if (bpStore.getBreakpoint(path, line)) {
    bpStore.removeBreakpoint(path, line);
    return;
  }

  const snap = bpStore.snapLine(model.getValue(), line);
  if (bpStore.getBreakpoint(path, snap.line)) {
    bpStore.removeBreakpoint(path, snap.line);
    return;
  }
  bpStore.addBreakpoint(path, snap.line, { valid: snap.valid });
}

function openBpMenu(rec, bp, x, y) {
  const path = bp.path;
  const line = bp.line;
  const items = [
    {
      label: "Remove Breakpoint",
      icon: "trash",
      onSelect: () => bpStore.removeBreakpoint(path, line),
    },
    {
      label: bp.enabled ? "Disable Breakpoint" : "Enable Breakpoint",
      onSelect: () => bpStore.updateBreakpoint(path, line, { enabled: !bp.enabled }),
    },
    {
      label: bp.condition ? "Edit Condition\u2026" : "Add Condition\u2026",
      onSelect: () => {
        openPrompt({
          title: "Condi\u00e7\u00e3o do breakpoint",
          label: `S\u00f3 pausa quando a express\u00e3o Luau for verdadeira (linha ${line}):`,
          value: bp.condition || "",
          placeholder: "ex.: health < 10",
          okLabel: "Salvar",
        }).then((text) => {
          if (text === null) return;
          bpStore.updateBreakpoint(path, line, { condition: text.trim() });
        });
      },
    },
    {
      label: bp.logMessage ? "Edit Log Message\u2026" : "Add Log Message\u2026",
      onSelect: () => {
        openPrompt({
          title: "Logpoint",
          label: "Mensagem impressa no Output (use {express\u00e3o} para interpolar):",
          value: bp.logMessage || "",
          placeholder: "ex.: Posi\u00e7\u00e3o atual: {part.Position}",
          okLabel: "Salvar",
        }).then((text) => {
          if (text === null) return;
          bpStore.updateBreakpoint(path, line, { logMessage: text.trim() });
        });
      },
    },
    { type: "separator" },
    {
      label: "Remove All Breakpoints",
      onSelect: () => bpStore.removeAll(),
    },
  ];
  openContextMenu({ x, y, items });
}


function resolveChainText(model, position) {
  const word = model.getWordAtPosition(position);
  if (!word) return null;
  const line = model.getLineContent(position.lineNumber);
  const upto = line.slice(0, word.endColumn - 1);
  const m = upto.match(/[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)*$/);
  if (!m) return null;
  return { chain: m[0], word };
}

function debugHover(model, position) {
  if (!debuggerController.isPaused()) return null;
  const found = resolveChainText(model, position);
  if (!found) return null;
  const segs = found.chain.split(/[.:]/);
  const root = debuggerController.resolveName(segs[0]);
  if (!root.found) return null;
  const interp = debuggerController.currentInterp();
  const bridge = debuggerController.currentBridge();
  let value = root.value;
  if (segs.length > 1) {
    if (interp && typeof interp.getIndex === "function") {
      for (let i = 1; i < segs.length; i++) {
        try {
          value = interp.getIndex(value, segs[i], position.lineNumber);
        } catch (e) {
          return null;                              
        }
      }
    } else {


      const res = debuggerController.evaluateInCurrent(found.chain.replace(/:/g, "."));
      if (!res || res.error) return null;
      value = res.value;
    }
  }
  const sum = summarize(value, bridge);
  const lines = [`**${found.chain}** = \`${sum.display}\``, "", `*tipo:* \`${typeOf(value, bridge)}\``];
  if (sum.expandable) {
    try {
      const kids = childrenOf(value, { bridge, depth: 0, limit: 12, ancestors: new Set() });
      if (kids.children.length) {
        lines.push("", "---");
        for (const c of kids.children) {
          lines.push(`- \`${c.name}\`: ${c.summary ? c.summary.display : "?"}`);
        }
        if (kids.hasMore) lines.push(`- \u2026 (${kids.total} itens no total \u2014 veja no painel Locals)`);
      }
    } catch (e) {                                           }
  }
  return {
    range: new monacoRef.Range(
      position.lineNumber, found.word.startColumn,
      position.lineNumber, found.word.endColumn,
    ),
    contents: [{ value: lines.join("\n") }],
  };
}


export function attachDebugGutter(editor, monaco) {
  if (editor.__rswDebugGutter) return;
  editor.__rswDebugGutter = true;
  monacoRef = monaco;


  editor.onMouseDown((e) => {
    if (!e.target || e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
    const model = editor.getModel();
    const rec = model ? recs.get(model) : null;
    const pos = e.target.position;
    if (!rec || !pos) return;
    const line = pos.lineNumber;
    const ev = e.event;
    if (ev && (ev.rightButton || (ev.browserEvent && ev.browserEvent.button === 2))) {
      const path = pathFor(rec);
      const bp = path ? bpStore.getBreakpoint(path, line) : null;
      if (bp) openBpMenu(rec, bp, ev.posx, ev.posy);
      return;
    }
    if (ev && ev.leftButton) toggleBreakpoint(rec, line);
  });


  editor.onContextMenu((e) => {
    if (e.target && e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
      if (e.event && e.event.preventDefault) e.event.preventDefault();
    }
  });


  editor.onMouseMove((e) => {
    const model = editor.getModel();
    const rec = model ? recs.get(model) : null;
    if (!rec) return;
    let previewLine = 0;
    if (e.target && e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) {
      previewLine = e.target.position.lineNumber;
      const path = pathFor(rec);
      if (path && bpStore.getBreakpoint(path, previewLine)) previewLine = 0;             
    }
    if (previewLine === rec.previewLine) return;
    rec.previewLine = previewLine;
    const decos = previewLine
      ? [{
          range: new monaco.Range(previewLine, 1, previewLine, 1),
          options: { glyphMarginClassName: "rsw-bp-glyph rsw-bp-glyph--preview" },
        }]
      : [];
    rec.previewIds = model.deltaDecorations(rec.previewIds || [], decos);
  });
  editor.onMouseLeave(() => {
    const model = editor.getModel();
    const rec = model ? recs.get(model) : null;
    if (!rec || !rec.previewLine) return;
    rec.previewLine = 0;
    rec.previewIds = model.deltaDecorations(rec.previewIds || [], []);
  });


  editor.addAction({
    id: "rsw.addToWatch",
    label: "Add to Watch",
    contextMenuGroupId: "9_debug",
    contextMenuOrder: 1,
    run: (ed) => {
      const model = ed.getModel();
      if (!model) return;
      let text = "";
      const sel = ed.getSelection();
      if (sel && !sel.isEmpty()) {
        text = model.getValueInRange(sel).trim();
      } else {
        const pos = ed.getPosition();
        const found = pos ? resolveChainText(model, pos) : null;
        text = found ? found.chain : "";
      }
      if (!text) return;
      debuggerController.addWatch(text);
      store.setLayout({ panels: { debugger: true } });
      bus.emit("debugger:showSection", { section: "watch" });
    },
  });


  monaco.languages.registerHoverProvider(LUAU_LANGUAGE_ID, {
    provideHover: (model, position) => {
      try {
        return debugHover(model, position);
      } catch (e) {
        return null;
      }
    },
  });

  wireBus();
}

export function debugAttachModel(model, opts) {
  if (!model || recs.has(model)) return;
  const rec = {
    model,
    getInstance: opts && opts.getInstance ? opts.getInstance : () => null,
    decoIds: [],
    decoEntries: [],
    previewIds: [],
    previewLine: 0,
    revalidateTimer: 0,
    lastPath: null,
    syncing: false,
  };
  recs.set(model, rec);
  rec.contentSub = model.onDidChangeContent(() => syncAfterEdit(rec));

  const path = pathFor(rec);
  if (path && bpStore.listForPath(path).length) {
    bpStore.revalidate(path, model.getValue());
  }
  if (monacoRef) renderDecorations(rec);
}

export function debugDetachModel(model) {
  const rec = recs.get(model);
  if (!rec) return;
  if (rec.revalidateTimer) clearTimeout(rec.revalidateTimer);
  try { if (rec.contentSub && rec.contentSub.dispose) rec.contentSub.dispose(); } catch (e) {            }
  recs.delete(model);
}

function wireBus() {
  if (busWired) return;
  busWired = true;
  bus.on("debugger:breakpointsChanged", () => renderAll());
  bus.on("debugger:paused", () => {

    renderAll();
  });
  bus.on("debugger:resumed", () => {
    pausedMark = null;
    renderAll();
  });
  bus.on("debugger:focusLine", (p) => {
    if (!p || !p.instance) return;
    if (p.highlight) {
      pausedMark = { path: bpStore.instancePath(p.instance), line: p.line };
    }
    renderAll();
  });
}
