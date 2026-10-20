import { logger } from "../core/logger.js";
import { setStatus } from "../core/project.js";
import { openModal, makeButton } from "./modal.js";
import { openAnimationEditor } from "./animationEditor.js";
import {
  getSelectableRig,
  isOpen as isAnimSessionOpen,
  getClip,
  exportClipData,
  importClipData,
  importSavedAnimation,
  listSavedAnimations,
} from "../animation/animationStore.js";

const MAX_ANIM_FILE_BYTES = 2 * 1024 * 1024;                                      

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}


export function canImportAnimation() {
  return isAnimSessionOpen() || !!getSelectableRig();
}

function safeFileName(name) {
  const s = String(name == null ? "" : name)
    .replace(/[^0-9A-Za-z _.-]/g, "")
    .trim()
    .slice(0, 80);
  return s || "animation";
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 0);
}

function pickLocalFile(accept, onPick) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.style.display = "none";
  document.body.appendChild(input);
  const cleanup = () => {
    if (input.parentNode) input.parentNode.removeChild(input);
  };
  input.addEventListener("change", () => {
    const file = input.files && input.files[0] ? input.files[0] : null;
    cleanup();
    if (file) onPick(file);
  });
  input.addEventListener("cancel", cleanup);
  input.click();
}

let activeDialog = null;

export function isAnimationImportOpen() {
  return !!activeDialog;
}

export function openAnimationImportDialog() {
  if (activeDialog) return false;
  if (!isAnimSessionOpen()) {
    if (!getSelectableRig()) {
      logger.warn("Import Animation: selecione um rig válido (R6, R15 ou malha com Bones).");
      return false;
    }
    if (!openAnimationEditor()) {
      logger.warn("Import Animation: não foi possível abrir o Animation Editor.");
      return false;
    }
  }

  const body = el("div", "rsw-form");
  const status = el("p", "rsw-modal__hint");
  status.hidden = true;

  const showStatus = (msg) => {
    status.hidden = false;
    status.textContent = msg;
  };

  const finishOk = (res, origem) => {
    setStatus(`Animação importada (${origem}): ${res.matched} track(s), ${res.keyframes} keyframe(s)`);
    if (activeDialog) activeDialog.close({ reason: "imported" });
  };

  body.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Importar de arquivo (.json)"));
  body.appendChild(
    el(
      "p",
      "rsw-modal__hint",
      "As tracks são remapeadas pelo NOME das partes do rig atual; tracks sem parte correspondente são ignoradas.",
    ),
  );
  const fileBtn = makeButton("Escolher arquivo\u2026", "default", () => {
    pickLocalFile(".json,application/json", (fileObj) => {
      if (Number(fileObj.size) > MAX_ANIM_FILE_BYTES) {
        showStatus("Arquivo excede o limite de 2 MB.");
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => showStatus("Falha ao ler o arquivo.");
      reader.onload = () => {
        let obj = null;
        try {
          obj = JSON.parse(String(reader.result || ""));
        } catch (_err) {
          showStatus("O arquivo não é um JSON válido.");
          return;
        }
        const res = importClipData(obj, fileObj.name || "arquivo");
        if (res && res.ok) finishOk(res, fileObj.name || "arquivo");
        else showStatus((res && res.error) || "Falha ao importar a animação.");
      };
      reader.readAsText(fileObj);
    });
  });
  body.appendChild(fileBtn);

  body.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Importar de animação salva"));
  const saved = listSavedAnimations();
  if (!saved.length) {
    body.appendChild(el("p", "rsw-modal__hint", "Nenhuma animação salva em ServerStorage/AnimSaves."));
  } else {
    const row = el("label", "rsw-avatar-field");
    row.appendChild(el("span", "rsw-avatar-field__label", "Animação"));
    const sel = el("select", "rsw-avatar-field__input");
    for (const s of saved) {
      const o = el("option", null, `${s.name} (${Number(s.duration).toFixed(2)}s)`);
      o.value = s.id;
      sel.appendChild(o);
    }
    row.appendChild(sel);
    body.appendChild(row);
    const loadBtn = makeButton("Importar selecionada", "default", () => {
      const res = importSavedAnimation(sel.value);
      if (res && res.ok) finishOk(res, "AnimSaves");
      else showStatus((res && res.error) || "Falha ao importar a animação.");
    });
    body.appendChild(loadBtn);
  }

  body.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Exportar animação atual"));
  const exportBtn = makeButton("Exportar (.json)", "default", () => {
    const data = exportClipData();
    if (!data) {
      showStatus("Sem animação aberta para exportar.");
      return;
    }
    const clip = getClip();
    const fname = `${safeFileName(clip && clip.name)}.json`;
    downloadText(fname, JSON.stringify(data, null, 2));
    showStatus(`Exportada como ${fname}.`);
  });
  body.appendChild(exportBtn);

  body.appendChild(status);

  const foot = el("div", "rsw-modal__btnrow");
  foot.appendChild(
    makeButton("Fechar", "ghost", () => {
      if (activeDialog) activeDialog.close({ reason: "button" });
    }),
  );

  activeDialog = openModal({
    title: "Import Animation",
    body,
    footer: foot,
    width: 520,
    className: "rsw-modal--animimport",
    onClose: () => {
      activeDialog = null;
    },
  });
  return true;
}
