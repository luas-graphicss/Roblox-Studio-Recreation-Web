import { Instance, Events } from "./instance.js";


import { getClassDef, isServiceClass } from "./classes.js";
import { makeColor, makeVector3 } from "./types.js";
import { collection } from "./collectionService.js";
import { logger } from "../core/logger.js";

export { collection } from "./collectionService.js";

export { Instance, Events };
export {
  PropTypes,
  Enums,
  makeColor,
  makeVector3,
  makeVector2,
  makeUDim,
  makeUDim2,
  makeRect,
  makeCFrame,
  makeRay,
  makeNumberRange,
  makeColorSequence,
  makeNumberSequence,
  sanitizeName,
  coerceValue,
  valuesEqual,
} from "./types.js";
export {
  getClassDef,
  getResolvedProperties,
  listServiceClasses,
  isServiceClass,
  isClass,

  registerDynamicClass,
  isDynamicClass,
  listDynamicClasses,
} from "./classes.js";


export function createInstance(className, opts = {}) {
  const def = getClassDef(className);
  if (!def) {
    logger.warn(`createInstance: classe desconhecida "${className}".`);
    return null;
  }
  let inst;
  try {
    inst = new Instance(className, { name: opts.name });
  } catch (err) {
    logger.warn(`createInstance falhou: ${err.message}`);
    return null;
  }
  if (opts.parent) inst.setParent(opts.parent);
  return inst;
}


const SERVICE_ORDER = [
  "Workspace",
  "Players",                                                  
  "ReplicatedFirst",                                                         
  "ReplicatedStorage",
  "ServerStorage",
  "ServerScriptService",
  "StarterGui",
  "StarterPack",
  "StarterPlayer",
  "SoundService",
  "Lighting",
  "Teams",
  "TextChatService",                                                    
  "TweenService",            
  "UserInputService",            
  "ContextActionService",            
  "MaterialService",                                                      
  "CollectionService",                                      
  "LocalizationService",
  "ClimateService",                                     
];

function addService(dataModel, className) {
  const svc = new Instance(className, {});
  svc.setParent(dataModel);                                           
  svc._locked = true;                                        
  return svc;
}


export function buildDataModel() {
  const dm = new Instance("DataModel", {});
  dm._locked = true;                                            

  const services = {};
  for (const name of SERVICE_ORDER) {
    services[name] = addService(dm, name);
  }




  const starterPlayer = services.StarterPlayer;
  const sps = new Instance("StarterPlayerScripts", { name: "StarterPlayerScripts" });
  sps.setParent(starterPlayer);
  const scs = new Instance("StarterCharacterScripts", { name: "StarterCharacterScripts" });
  scs.setParent(starterPlayer);


  const ws = services.Workspace;

  const camera = new Instance("Camera", { name: "Camera" });
  camera.setParent(ws);

  const terrain = new Instance("Terrain", { name: "Terrain" });
  terrain.setParent(ws);


  terrain._locked = true;

  const baseplate = new Instance("Part", { name: "Baseplate" });
  baseplate.setProperty("Size", makeVector3(512, 20, 512));
  baseplate.setProperty("Position", makeVector3(0, -10, 0));
  baseplate.setProperty("Anchored", true);
  baseplate.setProperty("Color", makeColor(0.41, 0.45, 0.42));
  baseplate.setProperty("Material", "Concrete");
  baseplate.setParent(ws);


  collection.rebuild(dm);

  return dm;
}


export function getService(dataModel, name) {
  if (!dataModel) return null;
  const svc = dataModel.findFirstChild(name);
  return svc && isServiceClass(svc.className) ? svc : null;
}
