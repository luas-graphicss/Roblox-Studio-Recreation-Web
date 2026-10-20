import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { store } from "../core/state.js";
import { createInstance, getService, getClassDef, makeVector3, makeColor } from "../datamodel/index.js";
import { logger } from "../core/logger.js";
import { modelSpecFor } from "./modelFactory.js";
import { getSpawnPosition } from "../viewport/objectOps.js";
import { assetStore, isRenderableImageExt } from "./assetStore.js";
import { getSkin, registerSkin } from "./skinRegistry.js";            
import { createBoneTree } from "./skinnedMeshFactory.js";            

import { buildPrimitiveObj } from "./objParser.js";
import { insertImportedAccessory, importedAccessoryFor } from "../avatar/avatarImport.js";
import { buildAccessoryInstance } from "../avatar/accessoryFactory.js";

const POS_LIMIT = 100000;
function clamp(n, fb = 0) {
  return Number.isFinite(n) ? Math.min(POS_LIMIT, Math.max(-POS_LIMIT, n)) : fb;
}

function workspace() {
  try {
    return getService(store.getDataModel(), "Workspace");
  } catch (_) {
    return null;
  }
}

function spawn() {
  try {
    const p = getSpawnPosition();
    if (p && typeof p === "object") {
      return { x: clamp(p.x), y: clamp(p.y), z: clamp(p.z) };
    }
  } catch (_) {

  }
  return { x: 0, y: 2.5, z: 0 };
}

function liveOnly(list) {
  return (list || []).filter((i) => i && !i.isDestroyed());
}


function extendsBasePart(className) {
  let cur = className;
  for (let guard = 0; cur && guard < 32; guard += 1) {
    if (cur === "BasePart") return true;
    const def = getClassDef(cur);
    cur = def ? def.extends : null;
  }
  return false;
}
function isBasePart(inst) {
  return (
    !!inst &&
    typeof inst.hasProperty === "function" &&
    typeof inst.className === "string" &&
    extendsBasePart(inst.className)
  );
}

function firstLiveSelected() {
  const sel = liveOnly(selection.get());
  return sel[0] || null;
}


function runInsert(name, root, parent) {
  if (!root || !parent) return null;
  const prevSel = selection.get();
  const ok = commands.execute({
    name,
    do() {
      if (root.isDestroyed() || parent.isDestroyed()) return false;
      root.setParent(parent);
      selection.set([root]);
      return true;
    },
    undo() {

      if (!root.isDestroyed()) root.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });
  return ok ? root : null;
}


export function insertModelAsset(asset) {
  const ws = workspace();
  if (!ws) {
    logger.warn("insertModelAsset: Workspace indispon\u00edvel.");
    return null;
  }
  const spec = modelSpecFor(asset);
  const model = createInstance("Model", { name: spec.name });
  if (!model) return null;
  const sp = spawn();
  for (const ps of spec.parts) {
    const part = createInstance("Part", { name: ps.name });
    if (!part) continue;
    if (part.hasProperty("Shape")) part.setProperty("Shape", ps.shape);
    if (part.hasProperty("Size")) part.setProperty("Size", makeVector3(ps.size[0], ps.size[1], ps.size[2]));
    if (part.hasProperty("Position")) {
      part.setProperty(
        "Position",
        makeVector3(clamp(sp.x + ps.pos[0]), clamp(sp.y + ps.pos[1]), clamp(sp.z + ps.pos[2])),
      );
    }


    if (Array.isArray(ps.rot) && part.hasProperty("Rotation")) {
      part.setProperty("Rotation", makeVector3(ps.rot[0], ps.rot[1], ps.rot[2]));
    }
    if (part.hasProperty("Color")) part.setProperty("Color", makeColor(ps.color[0], ps.color[1], ps.color[2]));
    if (part.hasProperty("Anchored")) part.setProperty("Anchored", true);
    part.setParent(model);
  }
  const result = runInsert(`Inserir ${spec.name}`, model, ws);
  if (result && asset && asset.id) assetStore.addRecent(asset.id);
  return result;
}


export function insertDecalAsset(asset) {
  const ws = workspace();
  if (!ws) {
    logger.warn("insertDecalAsset: Workspace indispon\u00edvel.");
    return null;
  }


  let rec = null;
  try {
    rec = asset && asset.id ? assetStore.getById(asset.id) : null;
  } catch (_) {
    rec = null;
  }
  const texExt = (rec && rec.ext) || (asset && asset.ext) || "";
  if (!isRenderableImageExt(texExt)) {
    logger.info(
      `"${(asset && asset.name) || texExt}" (.${String(texExt).toLowerCase()}) é dado de fotometria/LUT/HDRI, não textura de Decal — use nos painéis de Lighting (IES/Skybox) ou Color Grading.`,
    );
    return null;
  }
  const sel = firstLiveSelected();
  const parent = isBasePart(sel) ? sel : ws;
  const decal = createInstance("Decal", { name: (asset && asset.name) || "Decal" });
  if (!decal) return null;
  if (decal.hasProperty("Texture") && asset && asset.id) decal.setProperty("Texture", asset.id);
  const result = runInsert(`Inserir ${decal.getName ? decal.getName() : "Decal"}`, decal, parent);
  if (result && asset && asset.id) assetStore.addRecent(asset.id);
  return result;
}


export function insertAudioAsset(asset) {
  const ws = workspace();
  if (!ws) {
    logger.warn("insertAudioAsset: Workspace indispon\u00edvel.");
    return null;
  }
  const sel = firstLiveSelected();
  const parent = sel || ws;
  const sound = createInstance("Sound", { name: (asset && asset.name) || "Sound" });
  if (!sound) return null;
  if (sound.hasProperty("SoundId") && asset && asset.id) sound.setProperty("SoundId", asset.id);
  const result = runInsert(`Inserir ${(asset && asset.name) || "Sound"}`, sound, parent);
  if (result && asset && asset.id) assetStore.addRecent(asset.id);
  return result;
}


function ensureRealMeshAsset(asset) {
  if (!asset) return null;
  let rec = null;
  try {
    rec = asset.id ? assetStore.getById(asset.id) : null;
  } catch (_) {
    rec = null;
  }
  if (rec && rec.dataUri) return rec;
  if (asset.dataUri) return asset;
  const kinds = ["pyramid", "gem", "torus", "rock"];
  const seed = String((asset && asset.name) || asset.id || "mesh");
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  let text = "";
  try {
    text = buildPrimitiveObj(kinds[h % kinds.length]);
  } catch (_) {
    return null;
  }
  if (!text) return null;
  let dataUri = null;
  try {
    dataUri = "data:model/obj;base64," + btoa(unescape(encodeURIComponent(text)));
  } catch (_) {
    return null;
  }


  try {
    const dup = assetStore.list("meshes").find((r) => r && r.dataUri === dataUri);
    if (dup) return dup;
  } catch (_) {

  }
  return assetStore.addImported({
    name: `${seed.replace(/\.obj$/i, "")}.obj`,
    section: "meshes",
    ext: "obj",
    size: text.length,
    dataUri,
    mime: "model/obj",
  });
}

export function insertMeshAsset(asset) {
  const ws = workspace();
  if (!ws) {
    logger.warn("insertMeshAsset: Workspace indispon\u00edvel.");
    return null;
  }

  const real = ensureRealMeshAsset(asset);
  let mesh = createInstance("MeshPart", { name: (asset && asset.name) || "MeshPart" });
  if (!mesh) mesh = createInstance("Part", { name: (asset && asset.name) || "Mesh" });
  if (!mesh) return null;
  const sp = spawn();
  if (mesh.hasProperty("Position")) mesh.setProperty("Position", makeVector3(sp.x, clamp(sp.y + 2), sp.z));


  if (mesh.hasProperty("Size")) mesh.setProperty("Size", makeVector3(4, 4, 4));
  if (mesh.hasProperty("MeshId") && real && real.id) mesh.setProperty("MeshId", real.id);
  else if (mesh.hasProperty("MeshId") && asset && asset.id) mesh.setProperty("MeshId", asset.id);

  try {
    const skinId = real && real.id ? real.id : asset && asset.id;
    let skin = skinId ? getSkin(skinId) : null;


    if (!skin && skinId && real && real.skin) {
      skin = registerSkin(skinId, real.skin);
    }
    if (skin) {
      if (typeof mesh._setInternal === "function") mesh._setInternal("HasSkinnedMesh", true);
      createBoneTree(mesh, skin.joints);
    }
  } catch (_) {

  }


  if (mesh.hasProperty("TextureID") && asset && asset.textureId) mesh.setProperty("TextureID", asset.textureId);
  if (mesh.hasProperty("Color")) mesh.setProperty("Color", makeColor(0.55, 0.55, 0.62));
  if (mesh.hasProperty("Anchored")) mesh.setProperty("Anchored", true);
  const result = runInsert(`Inserir ${(asset && asset.name) || "Mesh"}`, mesh, ws);
  if (result && asset && asset.id) assetStore.addRecent(asset.id);
  return result;
}




export function insertAsset(asset) {
  if (!asset || typeof asset !== "object") return null;
  switch (asset.assetType) {
    case "Model":
      return insertModelAsset(asset);
    case "Decal":
      return insertDecalAsset(asset);
    case "Audio":
      return insertAudioAsset(asset);
    case "Mesh":
      return insertMeshAsset(asset);
    case "Accessory":
      return insertAccessoryAsset(asset);
    default:

      logger.info(`Inser\u00e7\u00e3o n\u00e3o suportada para tipo "${asset.assetType}": ${asset.name || asset.id}.`);
      return null;
  }
}

export function canInsert(assetType) {
  return (
    assetType === "Model" ||
    assetType === "Decal" ||
    assetType === "Audio" ||
    assetType === "Mesh" ||
    assetType === "Accessory"
  );
}

function insertAccessoryAsset(asset) {
  let result = null;
  if (importedAccessoryFor(asset.id)) {


    const acc = insertImportedAccessory(asset.id, null);
    if (acc && !acc.isDestroyed()) {
      const parent = (acc.getParent && acc.getParent()) || workspace();
      acc.setParent(null);
      const accName = (typeof acc.getName === "function" && acc.getName()) || (asset && asset.name) || "Accessory";
      result = parent ? runInsert(`Inserir ${accName}`, acc, parent) : null;
    } else {
      result = acc;
    }
  } else {
    result = insertMockAccessory(asset);
  }

  if (result && asset && asset.id) assetStore.addRecent(asset.id);
  return result;
}

function insertMockAccessory(asset) {
  const ws = workspace();
  if (!ws) {
    logger.warn("insertMockAccessory: Workspace indisponível.");
    return null;
  }
  const acc = buildAccessoryInstance({
    type: asset.accessoryType || "Hat",
    name: asset.name,
    layered: !!asset.layered,
    order: 1,
    puffiness: 1,
  });
  if (!acc) {
    logger.warn("insertMockAccessory: falha ao construir o Accessory.");
    return null;
  }
  const handle = acc.findFirstChild && acc.findFirstChild("Handle");
  if (handle && handle.hasProperty && handle.hasProperty("Position")) {
    const sp = spawn();
    handle.setProperty("Position", makeVector3(clamp(sp.x), clamp(sp.y + 2), clamp(sp.z)));
  }
  const accName =
    (typeof acc.getName === "function" && acc.getName()) || (asset && asset.name) || "Accessory";
  return runInsert(`Inserir ${accName}`, acc, ws);
}
