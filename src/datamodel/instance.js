import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import {
  PropTypes,
  sanitizeName,
  coerceValue,
  cloneValue,
  valuesEqual,
} from "./types.js";
import { getClassDef, getResolvedProperties } from "./classes.js";
import { createSessionScopedIdFactory } from "../core/resourceId.js";           
import {
  ATTRIBUTE_LIMITS,
  validateAttributeName,
  isSupportedAttributeType,
  coerceAttributeValue,
  cloneAttributeValue,
  attributeValuesEqual,
} from "./attributes.js";


const TAG_MAX_LENGTH = 200;
const MAX_TAGS_PER_INSTANCE = 50;


const DYNAMIC_PROP_TYPES = new Set([
  PropTypes.String,
  PropTypes.Number,
  PropTypes.Boolean,
  PropTypes.Vector3,
  PropTypes.Color,
]);
const MAX_DYNAMIC_PROPS = 128;
const DYNAMIC_XML_TAG_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;


export const Events = Object.freeze({
  PropertyChanged: "instance:propertyChanged",
  ParentChanged: "instance:parentChanged",
  ChildAdded: "instance:childAdded",
  ChildRemoved: "instance:childRemoved",
  Destroying: "instance:destroying",

  AttributeChanged: "instance:attributeChanged",
  TagAdded: "instance:tagAdded",
  TagRemoved: "instance:tagRemoved",
});


const createInstanceId = createSessionScopedIdFactory("inst_");
function nextId() {
  return createInstanceId();
}

export class Instance {
  constructor(className, opts = {}) {
    const def = getClassDef(className);
    if (!def) throw new Error(`Classe desconhecida: ${className}`);
    if (def.abstract && opts.__allowAbstract !== true) {
      throw new Error(
        `Classe abstrata não pode ser instanciada diretamente: ${className}`,
      );
    }


    Object.defineProperty(this, "className", {
      value: className,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, "id", {
      value: nextId(),
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, "__isInstance", {
      value: true,
      enumerable: false,
    });

    this._parent = null;
    this._children = [];
    this._props = new Map();                          
    this._locked = false;                         
    this._destroyed = false;
    this._connections = [];                                              


    for (const d of getResolvedProperties(className)) {
      this._props.set(d.name, { def: d, value: cloneValue(d.type, d.default) });
    }


    const initialName = opts.name != null ? opts.name : def.defaultName || className;
    const entry = this._props.get("Name");
    if (entry) entry.value = sanitizeName(initialName, def.defaultName || className);
  }


  get name() {
    const e = this._props.get("Name");
    return e ? e.value : "";
  }
  set name(v) {
    this.setProperty("Name", v);
  }
  isDestroyed() {
    return this._destroyed;
  }


  getFullName() {
    const parts = [];
    let node = this;
    let guard = 0;
    while (node && String(node.className || "") !== "DataModel" && guard < 64) {
      parts.unshift(node.name ? String(node.name) : "?");
      node = typeof node.getParent === "function" ? node.getParent() : null;
      guard += 1;
    }
    return parts.length ? parts.join(".") : (this.name ? String(this.name) : "?");
  }
  isLocked() {
    return this._locked;
  }


  hasProperty(name) {
    return this._props.has(name);
  }

  getProperty(name) {
    const e = this._props.get(name);
    return e ? e.value : undefined;
  }


  listProperties() {
    return [...this._props.values()].map((e) => ({
      name: e.def.name,
      type: e.def.type,
      value: e.value,
      default: e.def.default,
      readOnly: !!e.def.readOnly,
      options: e.def.options || null,
      hiddenOptions: e.def.hiddenOptions || null,


      dynamic: !!e.def.dynamic,
    }));
  }

  setProperty(name, value) {
    if (this._destroyed) return false;
    const entry = this._props.get(name);
    if (!entry) {
      logger.warn(`Propriedade inexistente ignorada: ${this.className}.${name}`);
      return false;
    }

    if (entry.def.readOnly) {
      logger.warn(`Escrita rejeitada em propriedade somente leitura: ${name}`);
      return false;
    }


    if (name === "Name") {


      if (this._locked) {
        logger.warn(`Instância fixa não pode ser renomeada: ${this.name}`);
        return false;
      }


      const def = getClassDef(this.className);
      const sanitized = sanitizeName(value, (def && def.defaultName) || this.className);
      if (valuesEqual(PropTypes.String, entry.value, sanitized)) return false;
      const old = entry.value;
      entry.value = sanitized;
      this._emitProp(name, sanitized, old);
      return true;
    }

    const res = coerceValue(entry.def.type, value, entry.def);
    if (!res.ok) {
      logger.warn(`Valor inválido para ${this.className}.${name} ignorado.`);
      return false;
    }

    if (valuesEqual(entry.def.type, entry.value, res.value)) return false;
    const old = entry.value;
    entry.value = res.value;
    this._emitProp(name, res.value, old);
    return true;
  }

  _emitProp(property, value, oldValue) {
    bus.emit(Events.PropertyChanged, { instance: this, property, value, oldValue });
  }


  _setInternal(name, value) {
    const entry = this._props.get(name);
    if (!entry) return false;
    const res = coerceValue(entry.def.type, value, entry.def);
    if (!res.ok) return false;
    if (valuesEqual(entry.def.type, entry.value, res.value)) return false;
    const old = entry.value;
    entry.value = res.value;
    this._emitProp(name, res.value, old);
    return true;
  }







  defineDynamicProperty(desc) {
    if (this._destroyed || !desc) return false;
    const def = getClassDef(this.className);
    if (!def || def.dynamic !== true) return false;
    const name = typeof desc.name === "string" ? desc.name : "";
    if (!name || name.length > 1024 || this._props.has(name)) return false;
    if (!DYNAMIC_PROP_TYPES.has(desc.type)) return false;
    let dynCount = 0;
    for (const e of this._props.values()) if (e.def.dynamic) dynCount += 1;
    if (dynCount >= MAX_DYNAMIC_PROPS) return false;
    const res = coerceValue(desc.type, desc.value, null);
    if (!res.ok) return false;
    const xmlTag =
      typeof desc.xmlTag === "string" && DYNAMIC_XML_TAG_RE.test(desc.xmlTag) ? desc.xmlTag : null;
    this._props.set(name, {
      def: {
        name,
        type: desc.type,
        default: cloneValue(desc.type, res.value),
        readOnly: false,
        options: null,
        hiddenOptions: null,
        integer: false,
        dynamic: true,
        xmlTag,
      },
      value: res.value,
    });
    return true;
  }


  listDynamicProperties() {
    const out = [];
    for (const e of this._props.values()) {
      if (e.def.dynamic) {
        out.push({ name: e.def.name, type: e.def.type, value: e.value, xmlTag: e.def.xmlTag || null });
      }
    }
    return out;
  }


  getAttribute(name) {
    const e = this._attributes && this._attributes.get(name);
    return e ? e.value : undefined;
  }

  getAttributeType(name) {
    const e = this._attributes && this._attributes.get(name);
    return e ? e.type : null;
  }

  hasAttribute(name) {
    return !!this._attributes && this._attributes.has(name);
  }


  getAttributesList() {
    if (!this._attributes) return [];
    return [...this._attributes.entries()].map(([name, e]) => ({
      name,
      type: e.type,
      value: e.value,
    }));
  }


  setAttribute(name, type, value) {
    if (this._destroyed) return { ok: false, error: "Instancia destruida." };
    const vn = validateAttributeName(name);
    if (!vn.ok) return { ok: false, error: vn.error };
    if (!isSupportedAttributeType(type)) {
      return { ok: false, error: `Tipo de atributo nao suportado: ${type}` };
    }
    const co = coerceAttributeValue(type, value);
    if (!co.ok) return { ok: false, error: co.error };
    if (!this._attributes) this._attributes = new Map();
    const existing = this._attributes.get(name);
    if (!existing && this._attributes.size >= ATTRIBUTE_LIMITS.maxAttributes) {
      return {
        ok: false,
        error: `Limite de ${ATTRIBUTE_LIMITS.maxAttributes} atributos por instancia atingido.`,
      };
    }
    if (existing && existing.type === type && attributeValuesEqual(type, existing.value, co.value)) {
      return { ok: true, changed: false };
    }
    this._attributes.set(name, { type, value: co.value });
    bus.emit(Events.AttributeChanged, {
      instance: this,
      name,
      value: co.value,
      attributeType: type,
    });
    return { ok: true, changed: true };
  }


  _setAttributeInternal(name, type, value) {
    if (!this._attributes) this._attributes = new Map();
    this._attributes.set(name, { type, value });
  }

  removeAttribute(name) {
    if (!this._attributes || !this._attributes.has(name)) return false;
    this._attributes.delete(name);
    bus.emit(Events.AttributeChanged, {
      instance: this,
      name,
      value: undefined,
      attributeType: null,
    });
    return true;
  }


  getTags() {
    return this._tags ? [...this._tags] : [];
  }

  hasTag(tag) {
    return !!this._tags && this._tags.has(tag);
  }

  addTag(tag) {
    if (this._destroyed) return false;
    if (typeof tag !== "string" || tag.length === 0) return false;
    let t = tag;
    if (t.length > TAG_MAX_LENGTH) t = t.slice(0, TAG_MAX_LENGTH);
    if (!this._tags) this._tags = new Set();
    if (this._tags.has(t)) return false;
    if (this._tags.size >= MAX_TAGS_PER_INSTANCE) {
      logger.warn(`Limite de ${MAX_TAGS_PER_INSTANCE} tags por instancia atingido.`);
      return false;
    }
    this._tags.add(t);
    bus.emit(Events.TagAdded, { instance: this, tag: t });
    return true;
  }

  removeTag(tag) {
    if (!this._tags || !this._tags.has(tag)) return false;
    this._tags.delete(tag);
    bus.emit(Events.TagRemoved, { instance: this, tag });
    return true;
  }


  getParent() {
    return this._parent;
  }

  setParent(newParent) {
    if (this._destroyed) return false;
    if (newParent === this._parent) return false;

    if (this._locked) {
      logger.warn(`Instância fixa não pode ser reparentada: ${this.name}`);
      return false;
    }
    if (newParent !== null) {
      if (
        !newParent ||
        newParent.__isInstance !== true ||
        newParent.__streamStale === true ||
        newParent.isDestroyed()
      ) {
        logger.warn(`Pai inválido ignorado para: ${this.name}`);
        return false;
      }

      if (newParent === this || this._isAncestorOf(newParent)) {
        logger.warn(`Reparent criaria ciclo; ignorado: ${this.name}`);
        return false;
      }
    }
    const old = this._parent;
    if (old) {
      const i = old._children.indexOf(this);
      if (i >= 0) old._children.splice(i, 1);
    }
    this._parent = newParent;
    if (newParent) newParent._children.push(this);

    if (old) bus.emit(Events.ChildRemoved, { parent: old, child: this });
    if (newParent) bus.emit(Events.ChildAdded, { parent: newParent, child: this });
    bus.emit(Events.ParentChanged, { instance: this, oldParent: old, newParent });
    return true;
  }

  _isAncestorOf(node) {
    let cur = node ? node._parent : null;
    while (cur) {
      if (cur === this) return true;
      cur = cur._parent;
    }
    return false;
  }

  getChildren() {
    return this._children.slice();
  }


  getDescendants() {


    const out = [];
    const stack = [];
    for (let i = this._children.length - 1; i >= 0; i--) stack.push(this._children[i]);
    while (stack.length) {
      const node = stack.pop();
      out.push(node);
      for (let i = node._children.length - 1; i >= 0; i--) stack.push(node._children[i]);
    }
    return out;
  }

  findFirstChild(name, recursive = false) {
    for (const c of this._children) {
      if (c.name === name) return c;
    }
    if (recursive) {


      const stack = [];
      for (let i = this._children.length - 1; i >= 0; i--) stack.push(this._children[i]);
      while (stack.length) {
        const node = stack.pop();
        if (node.name === name) return node;
        for (let i = node._children.length - 1; i >= 0; i--) stack.push(node._children[i]);
      }
    }
    return null;
  }


  findByPath(path) {
    const parts = Array.isArray(path) ? path : String(path).split("/");
    let cur = this;
    let stepped = false;
    for (const raw of parts) {
      const seg = String(raw).trim();
      if (!seg) continue;
      const next = cur.findFirstChild(seg);
      if (!next) return null;
      cur = next;
      stepped = true;
    }
    return stepped ? cur : null;
  }


  destroy() {
    if (this._destroyed) return false;
    if (this._locked) {
      logger.warn(`Instância fixa não pode ser destruída: ${this.name}`);
      return false;
    }

    const all = this.getDescendants();
    for (const node of all) node._teardown();

    const old = this._parent;
    if (old) {
      const i = old._children.indexOf(this);
      if (i >= 0) old._children.splice(i, 1);
      bus.emit(Events.ChildRemoved, { parent: old, child: this });
    }
    this._teardown();
    bus.emit(Events.ParentChanged, { instance: this, oldParent: old, newParent: null });
    return true;
  }


  _teardown() {
    if (this._destroyed) return;
    bus.emit(Events.Destroying, { instance: this });
    for (const off of this._connections) {
      try {
        off();
      } catch (_) {

      }
    }
    this._connections = [];
    this._parent = null;
    this._children = [];
    this._destroyed = true;
  }


  connect(event, handler) {
    if (this._destroyed) {
      logger.warn(`connect() ignorado em instância destruída: ${this.name}`);
      return () => {};
    }
    const off = bus.on(event, handler);
    this._connections.push(off);
    return off;
  }


  clone() {
    return cloneInstancesLinked([this])[0];
  }

  _cloneNode(map) {
    const copy = new Instance(this.className, {
      name: this.name,
      __allowAbstract: true,
    });
    copy._locked = false;                                   
    if (this._csgMesh) copy._csgMesh = this._csgMesh;


    if (this._importedSolid) copy._importedSolid = this._importedSolid;


    if (this._clipData) {
      try {
        Object.defineProperty(copy, "_clipData", {
          value: deepCloneJsonValue(this._clipData),
          writable: true,
          enumerable: false,
          configurable: true,
        });
      } catch (_) {                                                           }
    }
    if (Array.isArray(this._sourceParts)) {
      copy._sourceParts = this._sourceParts.map((p) => (p && typeof p.clone === "function" ? p.clone() : p));
    }


    for (const e of this._props.values()) {
      let entry = copy._props.get(e.def.name);
      if (!entry) {
        entry = { def: e.def, value: null };
        copy._props.set(e.def.name, entry);
      }
      if (e.def.type === PropTypes.Instance) {
        entry.value = null;                   
      } else {
        entry.value = cloneValue(e.def.type, e.value);
      }
    }

    if (this._attributes && this._attributes.size) {
      copy._attributes = new Map();
      for (const [n, e] of this._attributes) {
        copy._attributes.set(n, { type: e.type, value: cloneAttributeValue(e.type, e.value) });
      }
    }
    if (this._tags && this._tags.size) {
      copy._tags = new Set(this._tags);
    }


    if (this._rbxUnknownClass) {
      const src = this._rbxUnknownClass;
      const cloneBag = (node) => {
        if (!node || typeof node !== "object") return null;
        const out = { tag: node.tag, attrs: { ...(node.attrs || {}) } };
        if (Array.isArray(node.children)) {
          out.children = node.children.map(cloneBag).filter(Boolean);
        } else {
          out.text = node.text;
        }
        if ("refTarget" in node) out.refTarget = node.refTarget;
        return out;
      };
      copy._rbxUnknownClass = {
        className: src.className,
        props: Array.isArray(src.props) ? src.props.map(cloneBag).filter(Boolean) : [],
      };
    }
    if (this._rbxUnknownProps instanceof Map && this._rbxUnknownProps.size) {
      copy._rbxUnknownProps = new Map(this._rbxUnknownProps);
    }
    map.set(this, copy);
    for (const child of this._children) {
      const childCopy = child._cloneNode(map);
      childCopy._parent = copy;
      copy._children.push(childCopy);
    }
    return copy;
  }
}
















function relinkBagNodeRefs(node, map, depth) {
  if (!node || typeof node !== "object" || depth > 8) return;
  if (node.refTarget && map.has(node.refTarget)) {
    node.refTarget = map.get(node.refTarget);
  }
  if (Array.isArray(node.children)) {
    for (const ch of node.children) relinkBagNodeRefs(ch, map, depth + 1);
  }
}


function relinkClonedRefs(map) {
  for (const [orig, copy] of map) {
    for (const e of orig._props.values()) {
      if (e.def.type !== PropTypes.Instance || !e.value) continue;
      const dest = copy._props.get(e.def.name);
      if (!dest) continue;
      dest.value = map.has(e.value) ? map.get(e.value) : e.value;
    }
    const bag = copy._rbxUnknownClass;
    if (bag && Array.isArray(bag.props)) {
      for (const node of bag.props) relinkBagNodeRefs(node, map, 1);
    }
  }
}


export function cloneInstancesLinked(roots) {
  const map = new Map();                                                      
  const clones = [];


  const rootSet = new Set(roots);
  if (rootSet.size !== roots.length) {
    throw new Error("cloneInstancesLinked: raiz duplicada (snapshot-refs-1)");
  }
  for (const root of roots) {
    for (let p = root._parent; p; p = p._parent) {
      if (rootSet.has(p)) {
        throw new Error(
          "cloneInstancesLinked: raiz aninhada em outra raiz (snapshot-refs-1)",
        );
      }
    }
  }
  for (const root of roots) {
    const copy = root._cloneNode(map);
    if (!copy) {
      throw new Error("cloneInstancesLinked: _cloneNode não produziu clone (snapshot-refs-1)");
    }
    clones.push(copy);
  }
  relinkClonedRefs(map);
  return clones;
}
