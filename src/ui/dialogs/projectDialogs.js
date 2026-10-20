import { openModal, openConfirm, openPrompt, makeButton, _el as el } from "../modal.js";
import { field, textInput, selectInput, _el as fel } from "./fields.js";
import { createIcon } from "../icons.js";
import { project, setStatus } from "../../core/project.js";
import { logger } from "../../core/logger.js";
import { sanitizeName } from "../../datamodel/types.js";
import { persistence, formatBytes } from "../../persistence/persistence.js";
import * as projectStore from "../../persistence/projectStore.js";
import { LIMITS, PLACE_EXT, MODEL_EXT } from "../../persistence/serializer.js";
import * as versionHistory from "../../collab/versionHistory.js";            





function fmtDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString([], { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
  }
}


function fmtMeta(savedAt, size) {
  return [fmtDate(savedAt), formatBytes(size)].filter(Boolean).join(" \u00b7 ");
}


function readFileText(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Arquivo ausente."));
      return;
    }
    if (Number(file.size) > LIMITS.maxFileBytes) {
      reject(new Error("O arquivo excede o limite de 200MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result == null ? "" : reader.result));
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler o arquivo."));
    reader.readAsText(file);
  });
}


function pickLocalFile(accept, onPick) {
  const input = document.createElement("input");
  input.type = "file";
  if (accept) input.accept = accept;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  const cleanup = () => {
    if (input.parentNode) input.parentNode.removeChild(input);
  };
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    cleanup();
    if (file) onPick(file);
  });


  input.addEventListener("cancel", cleanup);
  input.click();
}


export function confirmUnsavedThen(proceed) {
  if (!project.isDirty()) {
    proceed();
    return;
  }
  openConfirm({
    title: "Unsaved changes",
    message: "Você tem alterações não salvas. Deseja salvá-las antes de continuar?",
    buttons: [
      { label: "Save", value: "save", kind: "primary" },
      { label: "Don't Save", value: "discard", kind: "default" },
      { label: "Cancel", value: "cancel", kind: "ghost" },
    ],
    closeOnBackdrop: false,
  }).then((choice) => {
    if (choice == null || choice === "cancel") return;
    if (choice === "save") {
      persistence.save().then((ok) => {
        if (ok) proceed();
      });
      return;
    }
    proceed();
  });
}


const DEST_BROWSER = "Browser Storage";
const DEST_DOWNLOAD = "Download File";


export function openSaveAsDialog() {
  return new Promise((resolve) => {
    let done = false;
    let handle = null;
    let saving = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(!!ok);
      if (handle) handle.close({ reason: "done" });
    };

    const draft = { name: project.getName() || "Untitled Place", dest: DEST_BROWSER };
    const body = el("div", "rsw-form");
    body.appendChild(field("Nome do lugar", textInput(draft.name, (v) => { draft.name = v; })));
    const destWrap = el("div", "rsw-saveas__dest");
    destWrap.appendChild(
      field("Destino", selectInput(draft.dest, [DEST_BROWSER, DEST_DOWNLOAD], (v) => { draft.dest = v; })),
    );
    body.appendChild(destWrap);
    const hint = el("p", "rsw-saveas__hint",
      "Browser Storage salva no navegador (My Projects). Download File baixa um arquivo " + PLACE_EXT + ".");
    body.appendChild(hint);
    body.appendChild(
      field("Coment\u00e1rio da vers\u00e3o (opcional)", textInput("", (v) => { draft.comment = v; })),
    );
    const err = el("p", "rsw-field__error");
    err.hidden = true;
    body.appendChild(err);

    const doSave = () => {
      if (saving) return;
      const clean = sanitizeName(draft.name, "");
      if (!clean) {
        err.textContent = "Informe um nome válido.";
        err.hidden = false;
        return;
      }
      err.hidden = true;
      saving = true;
      versionHistory.setPendingComment(draft.comment || "");
      const p =
        draft.dest === DEST_DOWNLOAD
          ? persistence.saveToFileDownload(clean)
          : persistence.saveToBrowser(clean);
      p.then((ok) => {
        saving = false;
        if (ok) finish(true);
        else {
          err.textContent = "Falha ao salvar. Veja o Output para detalhes.";
          err.hidden = false;
        }
      }).catch((e) => {


        saving = false;
        logger.warn("Save As falhou: " + (e && e.message));
        err.textContent = "Falha ao salvar. Veja o Output para detalhes.";
        err.hidden = false;
      });
    };

    const foot = el("div", "rsw-modal__btnrow");
    foot.appendChild(makeButton("Cancel", "ghost", () => finish(false)));
    foot.appendChild(makeButton("Save", "primary", doSave));
    handle = openModal({
      title: "Save As",
      body,
      footer: foot,
      width: 460,
      closeOnBackdrop: false,
      onClose: () => {
        if (!done) {
          done = true;
          resolve(false);
        }
      },
    });
  });
}


export function openOpenDialog() {
  let handle = null;
  const body = el("div", "rsw-open");

  const tabs = el("div", "rsw-open__tabs");
  const pane = el("div", "rsw-open__pane");
  const tabBtns = {};
  let active = "projects";

  function setTab(id) {
    active = id;
    for (const k of Object.keys(tabBtns)) {
      tabBtns[k].classList.toggle("rsw-open__tab--active", k === id);
    }
    if (id === "projects") renderProjects();
    else renderFromFile();
  }

  for (const [id, label] of [["projects", "My Projects"], ["file", "From File"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rsw-open__tab";
    b.textContent = label;
    b.addEventListener("click", () => setTab(id));
    tabBtns[id] = b;
    tabs.appendChild(b);
  }
  body.append(tabs, pane);

  function renderProjects() {
    pane.replaceChildren(el("div", "rsw-open__empty", "Carregando…"));
    projectStore.safeListProjects().then((list) => {
      if (active !== "projects") return;
      if (!list.length) {
        pane.replaceChildren(
          el("div", "rsw-open__empty", "Nenhum projeto salvo no navegador ainda. Use Save As \u2192 Browser Storage."),
        );
        return;
      }
      const grid = el("div", "rsw-open__grid");
      for (const rec of list) {
        grid.appendChild(buildCard(rec));
      }
      pane.replaceChildren(grid);
    });
  }

  function buildCard(rec) {
    const card = el("div", "rsw-open__card");
    if (rec.thumbnail) {
      const img = document.createElement("img");
      img.className = "rsw-open__thumb";
      img.alt = "";
      img.src = rec.thumbnail;
      card.appendChild(img);
    } else {
      const ph = el("div", "rsw-open__thumbph");
      ph.appendChild(createIcon("viewportframe", 28));
      card.appendChild(ph);
    }
    const nameEl = el("div", "rsw-open__name", rec.name || "Untitled Place");
    nameEl.setAttribute("title", rec.name || "");
    card.appendChild(nameEl);
    card.appendChild(el("div", "rsw-open__meta", fmtMeta(rec.savedAt, rec.size)));

    const actions = el("div", "rsw-open__actions");
    actions.appendChild(makeButton("Open", "primary", () => {
      confirmUnsavedThen(() => {
        persistence.openFromBrowser(rec.id).then((ok) => {
          if (ok && handle) handle.close({ reason: "open" });
        });
      });
    }));
    actions.appendChild(makeButton("Rename", "default", () => {
      openPrompt({
        title: "Rename Project",
        label: "Novo nome",
        value: rec.name,
        okLabel: "Rename",
        maxLength: 200,
        sanitize: (v) => sanitizeName(v, ""),
        validate: (v) => (v ? "" : "Informe um nome válido."),
      }).then((name) => {
        if (!name) return;


        projectStore.renameProject(rec.id, name)
          .then(() => renderProjects())
          .catch((e) => {
            logger.warn("Rename falhou: " + (e && e.message));
            setStatus("Rename failed");
            renderProjects();
          });
      });
    }));
    actions.appendChild(makeButton("Duplicate", "default", () => {
      projectStore.duplicateProject(rec.id)
        .then(() => renderProjects())
        .catch((e) => {
          logger.warn("Duplicate falhou: " + (e && e.message));
          setStatus("Duplicate failed");
          renderProjects();
        });
    }));
    actions.appendChild(makeButton("Delete", "ghost", () => {
      openConfirm({
        title: "Delete Project",
        message: `Deletar "${rec.name}" do navegador? Esta ação não pode ser desfeita.`,
        buttons: [
          { label: "Cancel", value: "cancel", kind: "ghost" },
          { label: "Delete", value: "delete", kind: "danger" },
        ],
      }).then((choice) => {
        if (choice !== "delete") return;
        projectStore.deleteProject(rec.id).then(() => {
          setStatus("Project deleted");
          renderProjects();
        }).catch((e) => logger.warn("Delete falhou: " + (e && e.message)));
      });
    }));
    card.appendChild(actions);
    return card;
  }

  function renderFromFile() {
    const wrap = el("div", "rsw-open__fromfile");
    wrap.appendChild(el("p", "rsw-open__hint",
      "Abra um arquivo de place (" + PLACE_EXT + ") salvo anteriormente com Save As \u2192 Download File."));
    const btn = makeButton("Choose File…", "primary", () => {
      pickLocalFile(PLACE_EXT + ",application/json", (file) => {
        readFileText(file)
          .then((text) => {
            confirmUnsavedThen(() => {
              persistence.openFromFileText(text, file.name).then((ok) => {
                if (ok && handle) handle.close({ reason: "open" });
              });
            });
          })
          .catch((e) => {
            logger.warn("Open from file: " + (e && e.message));
            setStatus("Falha ao ler o arquivo");
          });
      });
    });
    wrap.appendChild(btn);
    wrap.appendChild(el("p", "rsw-open__hint", "O arquivo é lido localmente; nada é enviado para a internet."));
    pane.replaceChildren(wrap);
  }

  const foot = el("div", "rsw-modal__btnrow");
  foot.appendChild(makeButton("Cancel", "default", () => handle && handle.close({ reason: "cancel" })));
  handle = openModal({ title: "Open Place", body, footer: foot, width: 640 });
  setTab("projects");
  return handle;
}





export function openInsertFromFile(targetInst) {
  pickLocalFile(MODEL_EXT + ",application/json", (file) => {
    readFileText(file)
      .then((text) => {
        persistence.insertModelFromText(text, targetInst || null);
      })
      .catch((e) => {
        logger.warn("Insert from File: " + (e && e.message));
        setStatus("Falha ao ler o arquivo");
      });
  });
}







export function openRecoverDialog(prefetched, opts) {
  const o = opts || {};
  let handle = null;
  const body = el("div", "rsw-recover");
  if (o.fromCrash) {
    body.appendChild(el("div", "rsw-recover__notice",
      "A sessão anterior não foi encerrada corretamente. Você pode recuperar um dos salvamentos automáticos abaixo."));
  }
  const list = el("ul", "rsw-recover__list");
  body.appendChild(list);

  function render(items) {
    list.replaceChildren();
    if (!items.length) {
      list.appendChild(el("div", "rsw-recover__empty", "Nenhum arquivo de recuperação encontrado."));
      return;
    }
    for (const rec of items) {
      const li = el("li", "rsw-recover__item");
      const info = el("div", "rsw-recover__info");
      info.appendChild(el("span", "name", rec.name || "Untitled Place"));
      info.appendChild(el("span", "meta", fmtMeta(rec.savedAt, rec.size)));
      const btns = el("div", "rsw-recover__btns");
      btns.appendChild(makeButton("Recover", "primary", () => {
        confirmUnsavedThen(() => {
          persistence.recoverAutosave(rec.id).then((ok) => {
            if (ok && handle) handle.close({ reason: "recovered" });
          });
        });
      }));
      btns.appendChild(makeButton("Delete", "ghost", async () => {


        const ok = await openConfirm({
          title: "Delete Recovery File",
          message: `Apagar o salvamento automático "${rec.name || "Untitled Place"}"? Esta ação não pode ser desfeita.`,
          buttons: [
            { label: "Cancel", value: false, kind: "ghost" },
            { label: "Delete", value: true, kind: "danger" },
          ],
        });
        if (ok !== true) return;
        persistence.deleteAutosave(rec.id).then(() => refresh());
      }));
      li.append(info, btns);
      list.appendChild(li);
    }
  }

  function refresh() {
    persistence.listRecoveryAutosaves().then((items) => render(items));
  }

  if (Array.isArray(prefetched)) render(prefetched);
  else refresh();

  const foot = el("div", "rsw-modal__btnrow");
  foot.appendChild(makeButton(o.fromCrash ? "Ignore" : "Close", "default", () => handle && handle.close({ reason: "close" })));
  handle = openModal({ title: "Recover Files", body, footer: foot, width: 520, closeOnBackdrop: !o.fromCrash });
  return handle;
}
