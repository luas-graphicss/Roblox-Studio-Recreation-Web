import { bus } from "../core/eventBus.js";
import { Events } from "./instance.js";


export const GET_TAGGED_LIMIT = 100000;


const index = new Map();

function isInDataModel(inst) {
  let p = inst;
  while (p) {
    if (p.className === "DataModel") return true;
    p = p._parent || null;
  }
  return false;
}

function indexAdd(inst, tag) {
  let set = index.get(tag);
  if (!set) {
    set = new Set();
    index.set(tag, set);
  }
  if (set.has(inst)) return;
  set.add(inst);
  bus.emit("collection:added", { instance: inst, tag });
}

function indexRemove(inst, tag) {
  const set = index.get(tag);
  if (!set || !set.has(inst)) return;
  set.delete(inst);
  if (set.size === 0) index.delete(tag);
  bus.emit("collection:removed", { instance: inst, tag });
}

function indexNode(node) {
  if (node._tags && node._tags.size) {
    for (const t of node._tags) indexAdd(node, t);
  }
}

function unindexNode(node) {
  if (node._tags && node._tags.size) {
    for (const t of node._tags) indexRemove(node, t);
  }
}

function addSubtree(node) {
  indexNode(node);
  for (const d of node.getDescendants()) indexNode(d);
}

function removeSubtree(node) {
  unindexNode(node);
  for (const d of node.getDescendants()) unindexNode(d);
}

let wired = false;


function wire() {
  if (wired) return;
  wired = true;

  bus.on(Events.ChildAdded, ({ child }) => {

    if (child && isInDataModel(child)) addSubtree(child);
  });

  bus.on(Events.ChildRemoved, ({ child }) => {


    if (child && !isInDataModel(child)) removeSubtree(child);
  });


  bus.on(Events.Destroying, ({ instance }) => {
    unindexNode(instance);
  });

  bus.on("instance:tagAdded", ({ instance, tag }) => {
    if (isInDataModel(instance)) indexAdd(instance, tag);
  });

  bus.on("instance:tagRemoved", ({ instance, tag }) => {
    indexRemove(instance, tag);
  });
}

wire();

export const collection = {


  rebuild(dataModel) {
    index.clear();
    if (dataModel) addSubtree(dataModel);
  },


  getTagged(tag) {
    const set = index.get(tag);
    if (!set) return { instances: [], truncated: false };
    const out = [];
    let truncated = false;
    for (const inst of set) {
      if (out.length >= GET_TAGGED_LIMIT) {
        truncated = true;
        break;
      }
      out.push(inst);
    }
    return { instances: out, truncated };
  },

  getAllTags() {
    return [...index.keys()];
  },

  getTagCount(tag) {
    const set = index.get(tag);
    return set ? set.size : 0;
  },
};
