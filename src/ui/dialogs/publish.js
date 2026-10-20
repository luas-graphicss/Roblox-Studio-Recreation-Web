import { openModal, makeButton } from "../modal.js";
import { createIcon } from "../icons.js";
import { project, GENRES, setStatus } from "../../core/project.js";
import { logger } from "../../core/logger.js";
import { persistence } from "../../persistence/persistence.js";            
import { sanitizeName } from "../../datamodel/types.js";
import {
  field,
  textInput,
  textArea,
  selectInput,
  checkboxField,
  _el as el,
} from "./fields.js";


const DANGEROUS = /[<>{}\\`$]/;

let _open = false;

export function openPublish(opts) {
  if (_open) return null;
  _open = true;
  const o = opts || {};
  const asNew = !!o.asNew;

  const settings = project.getSettings();
  const draft = {
    name: asNew ? "" : settings.general.name,
    description: settings.general.description,
    genre: settings.general.genre,
    makePublic: settings.permissions.privacy === "Public",
    copyLocked: !settings.general.allowCopying,
  };

  const body = el("div", "rsw-publish");


  const leftCol = el("div", "rsw-publish__left");
  const thumb = el("div", "rsw-publish__thumb");
  thumb.appendChild(el("span", "rsw-publish__thumb-label", "Thumbnail"));
  leftCol.appendChild(thumb);

  const preview = el("div", "rsw-publish__preview");
  preview.appendChild(el("div", "rsw-publish__preview-title", "Preview"));
  const pvName = el("div", "rsw-publish__pv-name");
  const pvDesc = el("div", "rsw-publish__pv-desc");
  const pvMeta = el("div", "rsw-publish__pv-meta");
  preview.append(pvName, pvDesc, pvMeta);
  leftCol.appendChild(preview);


  const rightCol = el("div", "rsw-publish__right");

  function refreshPreview() {


    const cleanName = sanitizeName(draft.name, "") || "(sem nome)";
    pvName.textContent = cleanName;




    pvDesc.textContent = draft.description ? draft.description : "Sem descrição.";
    pvMeta.textContent = draft.genre + " · " + (draft.makePublic ? "Público" : "Privado");
  }

  const nameInput = textInput(draft.name, (v) => { draft.name = v; refreshPreview(); }, { placeholder: "Nome do lugar" });
  rightCol.appendChild(field("Place Name", nameInput));
  rightCol.appendChild(field("Description", textArea(draft.description, (v) => { draft.description = v; refreshPreview(); }, { rows: 4 })));
  rightCol.appendChild(field("Genre", selectInput(draft.genre, GENRES, (v) => { draft.genre = v; refreshPreview(); })));
  rightCol.appendChild(checkboxField("Make game public", draft.makePublic, (c) => { draft.makePublic = c; refreshPreview(); }));
  rightCol.appendChild(checkboxField("Copy locked", draft.copyLocked, (c) => { draft.copyLocked = c; }));

  const errEl = el("p", "rsw-field__error");
  errEl.hidden = true;
  rightCol.appendChild(errEl);

  body.append(leftCol, rightCol);
  refreshPreview();


  const foot = el("div", "rsw-modal__btnrow");
  let handle = null;
  let publishing = false;
  let closedEarly = false;

  const cancelBtn = makeButton("Cancel", "default", () => {
    if (publishing) return;
    _open = false;
    if (handle) handle.close({ reason: "cancel" });
  });
  const publishBtn = makeButton(asNew ? "Publish As…" : "Publish", "primary", doPublish);
  publishBtn.classList.add("rsw-btn--lg");
  foot.append(cancelBtn, publishBtn);

  function doPublish() {
    if (publishing) return;


    const cleanName = sanitizeName(draft.name, "");
    if (!cleanName) {
      errEl.textContent = "Informe um nome válido para o lugar.";
      errEl.hidden = false;
      return;
    }
    if (DANGEROUS.test(draft.name)) {
      errEl.textContent = "O nome contém caracteres não permitidos.";
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    publishing = true;
    publishBtn.disabled = true;
    cancelBtn.disabled = true;
    publishBtn.textContent = "Publishing…";
    publishBtn.classList.add("is-loading");
    setStatus("Publishing to Roblox…", false);
    logger.info("Publishing place \"" + cleanName + "\"…", { source: "Studio" });


    persistence
      .buildPlaceTextAsync("Publishing\u2026")
      .then((built) => {


        const wc = project.getWorkingCopy();
        wc.general.name = cleanName;
        wc.general.description = draft.description;
        wc.general.genre = draft.genre;
        wc.general.allowCopying = !draft.copyLocked;
        wc.permissions.privacy = draft.makePublic ? "Public" : "Private";
        project.applySettings(wc);

        return import("../../cloud/cloudPublish.js")
          .then((cp) => cp.publishBuiltPlace(built, { name: cleanName, makePublic: draft.makePublic }))
          .then((res) => {
            if (res && res.place) {
              logger.info(
                "Cloud: \"" + res.place.name + "\" \u2014 Active Version v" + (res.place.activeVersionNum || "?") + " (Universe " + res.place.universeId + ").",
                { source: "Studio" },
              );
            }
          })
          .catch((e) => {
            logger.warn("Cloud publish: " + ((e && e.message) || e), { source: "Studio" });
          })
          .then(() => {
            logger.info(
              "Published successfully: " + cleanName + " (payload " + persistence.formatBytes(built.text.length) + ").",
              { source: "Studio" },
            );
            setStatus("Published successfully");
            publishing = false;
            if (closedEarly) {


              _open = false;
              return;
            }
            showSuccess(cleanName);
          });
      })
      .catch((e) => {
        logger.warn("Publish falhou: " + (e && e.message ? e.message : e), { source: "Studio" });
        publishing = false;
        if (closedEarly) {
          _open = false;
          setStatus("Publish failed");
          return;
        }
        publishBtn.disabled = false;
        cancelBtn.disabled = false;
        publishBtn.textContent = asNew ? "Publish As\u2026" : "Publish";
        publishBtn.classList.remove("is-loading");
        setStatus("Publish failed");
      });
  }

  function showSuccess(name) {
    const ok = el("div", "rsw-publish__success");
    const okIcon = el("div", "rsw-publish__success-icon");
    okIcon.appendChild(createIcon("check", 26));
    ok.appendChild(okIcon);
    ok.appendChild(el("div", "rsw-publish__success-title", "Published successfully"));
    ok.appendChild(el("div", "rsw-publish__success-msg", "\"" + name + "\" foi publicado (simulado)."));
    handle.bodyEl.replaceChildren(ok);
    foot.replaceChildren(makeButton("Done", "primary", () => {
      _open = false;
      handle.close({ reason: "done" });
    }));
  }

  handle = openModal({
    title: asNew ? "Publish to Roblox As…" : "Publish to Roblox",
    body,
    footer: foot,
    width: 720,
    className: "rsw-modal--publish",
    closeOnBackdrop: false,


    onClose: () => {
      closedEarly = true;
      if (!publishing) _open = false;
    },
  });
  return handle;
}
