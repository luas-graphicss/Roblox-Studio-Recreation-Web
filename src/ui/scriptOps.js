import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import { createInstance, getService } from "../datamodel/index.js";

const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);


const DEFAULT_SOURCE = {
  Script: 'print("Hello world!")\n',
  LocalScript: 'print("Hello from client!")\n',
  ModuleScript: "local module = {}\n\nreturn module\n",
};

function live(i) {
  return (
    i &&
    i.__isInstance === true &&
    typeof i.isDestroyed === "function" &&
    !i.isDestroyed()
  );
}

function dataModel() {
  try {
    return store.getDataModel();
  } catch (_) {
    return null;
  }
}

function serviceNamed(name) {
  try {
    return getService(dataModel(), name);
  } catch (_) {
    return null;
  }
}

export function selectedInstance() {
  const sel = (selection.get() || []).filter(live);
  return sel[0] || null;
}


export function isValidScriptParent(inst) {
  return !!(inst && live(inst) && !SCRIPT_CLASSES.has(inst.className));
}


function defaultParentFor(className) {
  if (className === "Script") return serviceNamed("ServerScriptService");
  if (className === "ModuleScript") return serviceNamed("ReplicatedStorage");
  if (className === "LocalScript") {
    const sp = serviceNamed("StarterPlayer");
    if (!sp) return null;

    const sub = typeof sp.findFirstChild === "function" ? sp.findFirstChild("StarterPlayerScripts") : null;
    return sub && live(sub) ? sub : sp;
  }
  return null;
}


function insertScriptClass(className) {
  if (!SCRIPT_CLASSES.has(className)) {
    logger.warn(`insertScriptClass: classe inválida "${className}".`, { source: "ScriptOps" });
    return null;
  }


  const sel = selectedInstance();
  const parent = sel && isValidScriptParent(sel) ? sel : defaultParentFor(className);

  if (!live(parent)) {
    logger.warn(`${className}: destino indisponível; inserção bloqueada.`, { source: "ScriptOps" });
    return null;
  }
  if (!isValidScriptParent(parent)) {
    logger.warn(`${className}: pai inválido ("${parent.className}"); inserção bloqueada.`, { source: "ScriptOps" });
    return null;
  }

  const inst = createInstance(className, {});
  if (!inst) return null;
  inst.setProperty("Source", DEFAULT_SOURCE[className]);                 

  const prevSel = selection.get();
  const ok = commands.execute({
    name: `Inserir ${className}`,
    do() {
      if (inst.isDestroyed() || !live(parent)) return false;
      inst.setParent(parent);
      selection.set([inst]);
      return true;
    },
    undo() {
      inst.setParent(null);
      selection.set((prevSel || []).filter(live));
    },
  });

  if (ok) {
    logger.info(`${className} inserido em ${parent.name}.`, { source: "ScriptOps" });
    return inst;
  }
  return null;
}

export function insertScript() {
  return insertScriptClass("Script");
}
export function insertLocalScript() {
  return insertScriptClass("LocalScript");
}
export function insertModuleScript() {
  return insertScriptClass("ModuleScript");
}
