import { terrainStore } from "../terrain/terrainStore.js";
import { cloneInstancesLinked } from "../datamodel/instance.js";


export function createSnapshot(dataModel) {
  const services = [];
  const entryOf = new Map();                                            
  const flat = [];                                                          
  for (const service of dataModel.getChildren()) {
    const entry = { service, childClones: [] };
    services.push(entry);
    entryOf.set(service, entry);
    for (const child of service.getChildren()) {


      if (child._locked === true) continue;
      flat.push({ service, child });
    }
  }


  const clones = cloneInstancesLinked(flat.map((f) => f.child));
  for (let i = 0; i < flat.length; i++) {
    if (clones[i]) entryOf.get(flat[i].service).childClones.push(clones[i]);
  }

  let terrain = null;
  try {
    const td = terrainStore.getData();
    if (td && typeof td.exportAll === "function") {
      terrain = { data: td.exportAll(), version: td.version };
    }
  } catch (e) {                                              }
  return { dataModel, services, terrain };
}


export function restoreSnapshot(snapshot) {
  if (!snapshot) return;


  for (const entry of snapshot.services) {
    const service = entry.service;
    for (const child of service.getChildren().slice()) {
      if (child._locked === true) continue;
      try {
        child.destroy();
      } catch (e) {

        try { child.setParent(null); } catch (e2) {              }
      }
    }
  }


  const flat = [];                                            
  for (const entry of snapshot.services) {
    for (const tmpl of entry.childClones) flat.push({ service: entry.service, tmpl });
  }
  const fresh = cloneInstancesLinked(flat.map((f) => f.tmpl));
  for (let i = 0; i < flat.length; i++) {
    if (fresh[i]) fresh[i].setParent(flat[i].service);
  }


  if (snapshot.terrain) {
    try {
      const td = terrainStore.getData();
      if (td && td.version !== snapshot.terrain.version) {
        td.importAll(snapshot.terrain.data);
        terrainStore.notifyChanged();
      }
    } catch (e) {                                                       }
  }
}
