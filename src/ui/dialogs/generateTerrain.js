import { openModal, makeButton, openConfirm } from "../modal.js";
import { _el, field, sectionTitle, selectInput } from "./fields.js";
import { terrainStore } from "../../terrain/terrainStore.js";
import { generateInto, normalizeParams, randomSeed, BIOME_NAMES } from "../../terrain/generator.js";
import { registerTerrainReplace } from "../../terrain/operations.js";
import { materialColorRGB } from "../../terrain/materials.js";

const EMPTY_SNAPSHOT = { chunks: [], min: null, max: null };

function slider(labelText, value, min, max, step, onInput) {
  const wrap = _el("div", "rsw-tg-slider");
  const head = _el("div", "rsw-tg-slider__head");
  const lbl = _el("span", "rsw-tg-slider__label", labelText);
  const val = _el("span", "rsw-tg-slider__value", String(value));
  head.appendChild(lbl); head.appendChild(val);
  const input = document.createElement("input");
  input.type = "range";
  input.className = "rsw-tg-range";
  input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    val.textContent = step < 1 ? v.toFixed(2) : String(v);
    onInput(v);
  });
  wrap.appendChild(head); wrap.appendChild(input);
  return wrap;
}

export function openGenerateTerrainDialog() {
  const data = terrainStore.getData();
  const savedSnapshot = data.exportAll();
  const hadTerrain = !data.isEmpty();
  const params = normalizeParams(terrainStore.getGenerateParams());

  let runHandle = null;


  let sceneDirty = false;
  let previewReady = false;
  let committed = false;

  const body = _el("div", "rsw-tg");


  const cols = _el("div", "rsw-tg__cols");
  const left = _el("div", "rsw-tg__left");
  const right = _el("div", "rsw-tg__right");
  cols.appendChild(left); cols.appendChild(right);
  body.appendChild(cols);


  const canvas = document.createElement("canvas");
  canvas.width = 168; canvas.height = 168;
  canvas.className = "rsw-tg__canvas";
  left.appendChild(sectionTitle("Preview"));
  left.appendChild(canvas);
  const status = _el("div", "rsw-tg__status", "Pronto.");
  left.appendChild(status);
  const bar = _el("div", "rsw-tg__bar");
  const barFill = _el("div", "rsw-tg__barfill");
  bar.appendChild(barFill);
  left.appendChild(bar);


  right.appendChild(sectionTitle("Bioma"));
  const biomeGrid = _el("div", "rsw-tg__biomes");
  const biomeButtons = {};
  BIOME_NAMES.forEach((name) => {
    const b = _el("button", "rsw-tg__biome", name);
    b.type = "button";
    b.addEventListener("click", () => { params.biome = name; refreshBiome(); });
    biomeButtons[name] = b;
    biomeGrid.appendChild(b);
  });
  right.appendChild(biomeGrid);
  function refreshBiome() {
    for (const n in biomeButtons) biomeButtons[n].classList.toggle("rsw-tg__biome--active", n === params.biome);
  }
  refreshBiome();


  right.appendChild(sectionTitle("Seed"));
  const seedRow = _el("div", "rsw-tg__seedrow");
  const seedInput = document.createElement("input");
  seedInput.type = "number";
  seedInput.className = "rsw-input rsw-input--number";
  seedInput.value = String(params.seed);
  seedInput.addEventListener("change", () => {


    const v = parseInt(seedInput.value, 10);
    if (!Number.isFinite(v)) { seedInput.value = String(params.seed); return; }
    params.seed = v | 0;
    seedInput.value = String(params.seed);
  });
  const rndBtn = makeButton("Randomizar", "ghost", () => { params.seed = randomSeed(); seedInput.value = String(params.seed); });
  seedRow.appendChild(seedInput); seedRow.appendChild(rndBtn);
  right.appendChild(seedRow);


  right.appendChild(sectionTitle("Parametros"));
  right.appendChild(slider("Tamanho do bioma", params.biomeSize, 0, 1, 0.01, (v) => { params.biomeSize = v; }));
  right.appendChild(slider("Frequencia de cavernas", params.caveFrequency, 0, 1, 0.01, (v) => { params.caveFrequency = v; }));
  right.appendChild(slider("Altura do terreno", params.terrainHeight, 0, 1, 0.01, (v) => { params.terrainHeight = v; }));
  right.appendChild(slider("Nivel da agua", params.waterLevel, 0, 1, 0.01, (v) => { params.waterLevel = v; }));

  function setProgress(p) {
    barFill.style.width = Math.round(p * 100) + "%";
    status.textContent = p >= 1 ? "Concluido." : "Gerando... " + Math.round(p * 100) + "%";
  }

  function drawPreview() {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const b = data.getBounds();
    if (!b) { ctx.fillStyle = "#222"; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    const minX = b.min[0], minZ = b.min[2], maxX = b.max[0], maxZ = b.max[2];
    const w = Math.max(1, maxX - minX + 1), h = Math.max(1, maxZ - minZ + 1);
    const sx = canvas.width / w, sz = canvas.height / h;
    const maxY = b.max[1], minY = b.min[1];
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        let topY = null, mat = 0;
        for (let y = maxY; y >= minY; y--) { if (data.getOcc(x, y, z) > 0) { topY = y; mat = data.getMat(x, y, z); break; } }
        if (topY === null) continue;
        const c = materialColorRGB(mat);
        const shade = 0.55 + 0.45 * ((topY - minY) / Math.max(1, maxY - minY));
        ctx.fillStyle = `rgb(${Math.round(c[0]*255*shade)},${Math.round(c[1]*255*shade)},${Math.round(c[2]*255*shade)})`;
        ctx.fillRect((x - minX) * sx, (z - minZ) * sz, Math.ceil(sx), Math.ceil(sz));
      }
    }
  }

  function cancelRun() { if (runHandle && runHandle.cancel) runHandle.cancel(); runHandle = null; }

  function doGenerate(commit) {
    terrainStore.setGenerateParams(params);
    cancelRun();
    data.importAll(EMPTY_SNAPSHOT);                        


    sceneDirty = true;
    previewReady = false;
    terrainStore.notifyChanged();
    setProgress(0);
    runHandle = generateInto(data, params, {
      onProgress: setProgress,
      onComplete: () => {
        runHandle = null;
        terrainStore.notifyChanged();
        drawPreview();
        if (commit) {
          registerTerrainReplace("Generate Terrain", savedSnapshot, data.exportAll());
          committed = true;
          close();
        } else {
          previewReady = true;
        }
      },
    });
  }

  function restoreIfNeeded() {
    cancelRun();
    if (sceneDirty && !committed) {
      data.importAll(savedSnapshot);
      terrainStore.notifyChanged();
      sceneDirty = false;
      previewReady = false;
    }
  }


  const footer = _el("div", "rsw-tg__foot");
  const previewBtn = makeButton("Preview", "ghost", () => doGenerate(false));
  const cancelBtn = makeButton("Cancelar", "ghost", () => { restoreIfNeeded(); close(); });
  const genBtn = makeButton("Gerar", "primary", async () => {


    if (hadTerrain && !sceneDirty) {
      const ok = await openConfirm({
        title: "Substituir terreno",
        message: "Ja existe terreno. Gerar ira substituir o terreno atual. Deseja continuar?",
        buttons: [{ label: "Cancelar", value: false, kind: "ghost" }, { label: "Substituir", value: true, kind: "danger" }],
      });
      if (!ok) return;
    }
    if (previewReady && !runHandle) {

      registerTerrainReplace("Generate Terrain", savedSnapshot, data.exportAll());
      committed = true;
      close();
    } else {


      doGenerate(true);
    }
  });
  footer.appendChild(previewBtn);
  footer.appendChild(cancelBtn);
  footer.appendChild(genBtn);

  const modal = openModal({
    title: "Generate Terrain",
    width: 620,
    className: "rsw-tg-modal",
    body,
    footer,
    onClose: () => { restoreIfNeeded(); },
  });
  function close() { modal.close(); }

  drawPreview();
  return modal;
}


export function generateTerrainCommitted(rawParams, callbacks) {
  const cb = callbacks || {};
  const data = terrainStore.getData();
  const before = data.exportAll();
  const params = normalizeParams(rawParams || terrainStore.getGenerateParams());
  data.importAll(EMPTY_SNAPSHOT);
  terrainStore.notifyChanged();
  return generateInto(data, params, {
    onProgress: cb.onProgress,
    onComplete: () => {
      terrainStore.notifyChanged();
      registerTerrainReplace("Generate Terrain", before, data.exportAll());
      if (typeof cb.onComplete === "function") cb.onComplete();
    },
  });
}
