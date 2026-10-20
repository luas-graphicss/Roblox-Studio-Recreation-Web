import { PropTypes } from "../datamodel/index.js";
import { LuaError } from "./lua/interpreter.js";
import { Signal } from "./scheduler.js";

export const EASING_STYLES = Object.freeze([
  "Linear",
  "Sine",
  "Back",
  "Quad",
  "Quart",
  "Quint",
  "Bounce",
  "Elastic",
  "Exponential",
  "Circular",
  "Cubic",
]);
export const EASING_DIRECTIONS = Object.freeze(["In", "Out", "InOut"]);
export const PLAYBACK_STATES = Object.freeze([
  "Begin",
  "Delayed",
  "Playing",
  "Paused",
  "Completed",
  "Cancelled",
]);


export const MAX_TWEEN_TIME = 86400;       
export const MAX_REPEAT_COUNT = 100000;
export const MAX_ACTIVE_TWEENS = 10000;

const num = (v, d = 0) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : d;
};


function bounceOut(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    t -= 1.5 / d1;
    return n1 * t * t + 0.75;
  }
  if (t < 2.5 / d1) {
    t -= 2.25 / d1;
    return n1 * t * t + 0.9375;
  }
  t -= 2.625 / d1;
  return n1 * t * t + 0.984375;
}


function easeIn(style, t) {
  switch (style) {
    case "Linear":
      return t;
    case "Sine":
      return 1 - Math.cos((t * Math.PI) / 2);
    case "Quad":
      return t * t;
    case "Cubic":
      return t * t * t;
    case "Quart":
      return t * t * t * t;
    case "Quint":
      return t * t * t * t * t;
    case "Exponential":
      return t <= 0 ? 0 : Math.pow(2, 10 * t - 10);
    case "Circular":
      return 1 - Math.sqrt(1 - t * t);
    case "Back": {
      const s = 1.70158;                              
      return t * t * ((s + 1) * t - s);
    }
    case "Elastic": {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      const p = 0.3;                            
      return -Math.pow(2, 10 * (t - 1)) * Math.sin((((t - 1) - p / 4) * (2 * Math.PI)) / p);
    }
    case "Bounce":
      return 1 - bounceOut(1 - t);
    default:
      return t;
  }
}


export function ease(style, direction, alpha) {
  let t = typeof alpha === "number" && Number.isFinite(alpha) ? alpha : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  switch (direction) {
    case "In":
      return easeIn(style, t);
    case "InOut":
      return t < 0.5 ? easeIn(style, t * 2) / 2 : 1 - easeIn(style, (1 - t) * 2) / 2;
    case "Out":
    default:
      return 1 - easeIn(style, 1 - t);
  }
}


export function easingStyleItem(name) {
  return { __ud: "EnumItem", enumType: "EasingStyle", name, value: EASING_STYLES.indexOf(name) };
}
export function easingDirectionItem(name) {
  return { __ud: "EnumItem", enumType: "EasingDirection", name, value: EASING_DIRECTIONS.indexOf(name) };
}
export function playbackStateItem(name) {
  return { __ud: "EnumItem", enumType: "PlaybackState", name, value: PLAYBACK_STATES.indexOf(name) };
}

function luaLabel(v) {
  if (v && v.__ud === "EnumItem") return `Enum.${v.enumType}.${v.name}`;
  if (v && v.__ud) return String(v.__ud);
  return String(v);
}


export function resolveEasingStyle(value, fallback = "Quad") {
  if (value === undefined || value === null) return fallback;
  let name = null;
  if (typeof value === "string") name = value;
  else if (value && value.__ud === "EnumItem" && value.enumType === "EasingStyle") name = value.name;
  if (name && EASING_STYLES.indexOf(name) >= 0) return name;
  throw new LuaError("EasingStyle inv\u00e1lido: " + luaLabel(value));
}

export function resolveEasingDirection(value, fallback = "Out") {
  if (value === undefined || value === null) return fallback;
  let name = null;
  if (typeof value === "string") name = value;
  else if (value && value.__ud === "EnumItem" && value.enumType === "EasingDirection") name = value.name;
  if (name && EASING_DIRECTIONS.indexOf(name) >= 0) return name;
  throw new LuaError("EasingDirection inv\u00e1lido: " + luaLabel(value));
}


export function makeTweenInfo(time, easingStyle, easingDirection, repeatCount, reverses, delayTime) {
  let t = time === undefined || time === null ? 1 : num(time, 1);
  if (!(t >= 0)) t = 0;
  if (t > MAX_TWEEN_TIME) t = MAX_TWEEN_TIME;
  const style = resolveEasingStyle(easingStyle, "Quad");
  const dir = resolveEasingDirection(easingDirection, "Out");
  let rc = repeatCount === undefined || repeatCount === null ? 0 : Math.floor(num(repeatCount, 0));
  if (rc < 0) rc = -1;                                
  if (rc > MAX_REPEAT_COUNT) rc = MAX_REPEAT_COUNT;
  const rev = reverses === true;
  let dl = delayTime === undefined || delayTime === null ? 0 : num(delayTime, 0);
  if (!(dl >= 0)) dl = 0;
  if (dl > MAX_TWEEN_TIME) dl = MAX_TWEEN_TIME;
  return Object.freeze({
    __ud: "TweenInfo",
    time: t,
    easingStyle: style,
    easingDirection: dir,
    repeatCount: rc,
    reverses: rev,
    delayTime: dl,
  });
}

export function tweenInfoEquals(a, b) {
  return (
    !!a && !!b && a.__ud === "TweenInfo" && b.__ud === "TweenInfo" &&
    a.time === b.time &&
    a.easingStyle === b.easingStyle &&
    a.easingDirection === b.easingDirection &&
    a.repeatCount === b.repeatCount &&
    a.reverses === b.reverses &&
    a.delayTime === b.delayTime
  );
}

export function tweenInfoToString(info) {
  return `TweenInfo(${info.time}, Enum.EasingStyle.${info.easingStyle}, Enum.EasingDirection.${info.easingDirection}, ${info.repeatCount}, ${info.reverses}, ${info.delayTime})`;
}


export function serializeTweenInfo(info) {
  return {
    time: info.time,
    easingStyle: info.easingStyle,
    easingDirection: info.easingDirection,
    repeatCount: info.repeatCount,
    reverses: info.reverses,
    delayTime: info.delayTime,
  };
}
export function deserializeTweenInfo(obj) {
  if (!obj || typeof obj !== "object") return makeTweenInfo();
  return makeTweenInfo(obj.time, obj.easingStyle, obj.easingDirection, obj.repeatCount, obj.reverses, obj.delayTime);
}


const lerp = (a, b, t) => a + (b - a) * t;

const INTERPOLATORS = {
  [PropTypes.Number]: (a, b, t) => lerp(a, b, t),
  [PropTypes.Vector3]: (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }),
  [PropTypes.Vector2]: (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }),
  [PropTypes.Color]: (a, b, t) => ({ r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) }),
  [PropTypes.UDim]: (a, b, t) => ({ scale: lerp(a.scale, b.scale, t), offset: lerp(a.offset, b.offset, t) }),
  [PropTypes.UDim2]: (a, b, t) => ({
    xScale: lerp(a.xScale, b.xScale, t),
    xOffset: lerp(a.xOffset, b.xOffset, t),
    yScale: lerp(a.yScale, b.yScale, t),
    yOffset: lerp(a.yOffset, b.yOffset, t),
  }),
  [PropTypes.Rect]: (a, b, t) => ({
    minX: lerp(a.minX, b.minX, t),
    minY: lerp(a.minY, b.minY, t),
    maxX: lerp(a.maxX, b.maxX, t),
    maxY: lerp(a.maxY, b.maxY, t),
  }),
  [PropTypes.NumberRange]: (a, b, t) => ({ min: lerp(a.min, b.min, t), max: lerp(a.max, b.max, t) }),
};

const NON_TWEENABLE_LABEL = {
  [PropTypes.String]: "string",
  [PropTypes.Boolean]: "boolean",
  [PropTypes.Enum]: "Enum",
  [PropTypes.Instance]: "Instance",
  [PropTypes.ColorSequence]: "ColorSequence",
  [PropTypes.NumberSequence]: "NumberSequence",
};

function cloneVal(type, v) {
  if (v === null || v === undefined || typeof v === "number") return v;
  return Object.assign({}, v);
}


function convertTarget(type, propName, value) {
  const fail = (expected) => {
    throw new LuaError(`TweenService:Create: o valor alvo de '${propName}' deve ser ${expected}`);
  };
  switch (type) {
    case PropTypes.Number:
      if (typeof value !== "number" || !Number.isFinite(value)) fail("um number");
      return value;
    case PropTypes.Vector3:
      if (!value || value.__ud !== "Vector3") fail("um Vector3");
      return { x: num(value.x), y: num(value.y), z: num(value.z) };
    case PropTypes.Vector2:
      if (!value || value.__ud !== "Vector2") fail("um Vector2");
      return { x: num(value.x), y: num(value.y) };
    case PropTypes.Color:
      if (!value || value.__ud !== "Color3") fail("um Color3");
      return { r: num(value.r), g: num(value.g), b: num(value.b) };
    case PropTypes.UDim:
      if (!value || value.__ud !== "UDim") fail("um UDim");
      return { scale: num(value.scale), offset: num(value.offset) };
    case PropTypes.UDim2:
      if (!value || value.__ud !== "UDim2") fail("um UDim2");
      return {
        xScale: num(value.xScale),
        xOffset: num(value.xOffset),
        yScale: num(value.yScale),
        yOffset: num(value.yOffset),
      };
    case PropTypes.Rect:
      if (!value || value.__ud !== "Rect") fail("um Rect");
      return { minX: num(value.minX), minY: num(value.minY), maxX: num(value.maxX), maxY: num(value.maxY) };
    case PropTypes.NumberRange:
      if (typeof value === "number" && Number.isFinite(value)) return { min: value, max: value };
      if (!value || value.__ud !== "NumberRange") fail("um NumberRange");
      return { min: num(value.min), max: num(value.max) };
    default:
      fail("de um tipo interpol\u00e1vel");
  }
}


export function createTweenManager(options = {}) {
  const scheduler = options.scheduler || null;
  const logger = options.logger || null;
  const dataModel = options.dataModel || null;

  const active = [];                                                            
  const byProperty = new Map();                                                   
  let disposed = false;

  const warn = (msg) => {
    if (logger && logger.warn) logger.warn(msg, { source: "Studio" });
  };

  function mapFor(inst) {
    let m = byProperty.get(inst);
    if (!m) {
      m = new Map();
      byProperty.set(inst, m);
    }
    return m;
  }

  function removeFromActive(tween) {
    const i = active.indexOf(tween);
    if (i >= 0) active.splice(i, 1);
    tween._active = false;
  }


  function releaseMappings(tween) {
    const m = byProperty.get(tween.instance);
    if (!m) return;
    for (const e of tween._entries) {
      if (m.get(e.name) === tween) m.delete(e.name);
    }
    if (m.size === 0) byProperty.delete(tween.instance);
  }

  function fireCompleted(tween, stateName) {
    if (tween._completed) tween._completed.fire([playbackStateItem(stateName)]);
  }


  function finish(tween, finalState, revert) {
    if (tween.state === "Completed" || tween.state === "Cancelled") return;
    removeFromActive(tween);
    releaseMappings(tween);
    tween.state = finalState;
    if (revert && !tween.instance.isDestroyed()) {
      for (const e of tween._entries) {
        if (e.start !== null && e.start !== undefined) {
          tween.instance.setProperty(e.name, cloneVal(e.type, e.start));
        }
      }
    }
    fireCompleted(tween, finalState);
  }





  function applyEntries(tween, easedT, exact) {
    const inst = tween.instance;
    for (const e of tween._entries) {
      const fn = INTERPOLATORS[e.type];
      if (!fn || e.start === null || e.start === undefined) continue;
      let v;
      if (exact === "start") v = cloneVal(e.type, e.start);
      else if (exact === "target") v = cloneVal(e.type, e.target);
      else v = fn(e.start, e.target, easedT);
      inst.setProperty(e.name, v);
    }
  }

  function advance(tween, dt) {
    const info = tween.tweenInfo;
    if (tween.instance.isDestroyed()) {

      finish(tween, "Cancelled", false);
      return;
    }
    let rem = dt;
    if (tween._delayLeft > 0) {
      tween._delayLeft -= rem;
      if (tween._delayLeft > 0) return;
      rem = -tween._delayLeft;                                    
      tween._delayLeft = 0;
      tween.state = "Playing";
    }
    const dur = info.time;
    if (dur <= 0) {

      applyEntries(tween, 1, info.reverses ? "start" : "target");
      finish(tween, "Completed", false);
      return;
    }
    let guard = 0;
    for (;;) {
      tween._cursor += rem;
      rem = 0;
      let alpha = tween._cursor / dur;
      if (alpha > 1) {
        rem = tween._cursor - dur;
        alpha = 1;
        tween._cursor = dur;
      }
      const t = tween._phase === 1 ? alpha : 1 - alpha;
      if (alpha >= 1) {
        applyEntries(tween, t, tween._phase === 1 ? "target" : "start");
      } else {
        applyEntries(tween, ease(info.easingStyle, info.easingDirection, t), null);
        return;
      }

      if (info.reverses && tween._phase === 1) {
        tween._phase = -1;
        tween._cursor = 0;
      } else if (info.repeatCount === -1 || tween._repeatsLeft > 0) {
        if (info.repeatCount !== -1) tween._repeatsLeft--;
        tween._phase = 1;
        tween._cursor = 0;


        if (info.delayTime > 0) {
          tween._delayLeft = info.delayTime;
          tween.state = "Delayed";
          if (rem > 0) {
            tween._delayLeft -= rem;
            rem = 0;
            if (tween._delayLeft <= 0) {
              rem = -tween._delayLeft;
              tween._delayLeft = 0;
              tween.state = "Playing";
            }
          }
          if (tween._delayLeft > 0) return;
        }
      } else {
        finish(tween, "Completed", false);
        return;
      }

      if (rem <= 0 || guard++ > 1000) return;
    }
  }


  function step(dt) {
    if (disposed || active.length === 0) return;
    const list = active.slice();                                             
    for (const tween of list) {
      if (!tween._active) continue;
      if (tween.state !== "Playing" && tween.state !== "Delayed") continue;
      try {
        advance(tween, dt);
      } catch (e) {
        warn("Tween: erro ao atualizar '" + (tween.instance ? tween.instance.name : "?") + "': " + (e && e.message));
        finish(tween, "Cancelled", false);
      }
    }
  }



  function claimProperties(tween) {
    const inst = tween.instance;
    for (const e of tween._entries) {


      const cur = byProperty.get(inst);
      const other = cur ? cur.get(e.name) : undefined;
      if (other && other !== tween) finish(other, "Cancelled", false);
      mapFor(inst).set(e.name, tween);
    }
  }

  function play(tween) {
    if (disposed) return;
    const inst = tween.instance;
    if (inst.isDestroyed()) {
      warn("Tween: a Instance j\u00e1 foi destru\u00edda; Play ignorado.");
      return;
    }
    if (tween.state === "Paused") {

      claimProperties(tween);
      tween.state = tween._delayLeft > 0 ? "Delayed" : "Playing";
      if (!tween._active) {
        tween._active = true;
        active.push(tween);
      }
      return;
    }
    if (tween.state === "Playing" || tween.state === "Delayed") {


      return;
    }

    if (active.length >= MAX_ACTIVE_TWEENS) {
      warn(`TweenService: limite de ${MAX_ACTIVE_TWEENS} tweens ativos atingido; o tween foi rejeitado.`);
      return;
    }
    for (const e of tween._entries) {
      const cur = inst.getProperty(e.name);
      e.start = cur === null || cur === undefined ? cloneVal(e.type, e.target) : cloneVal(e.type, cur);
    }
    claimProperties(tween);
    tween._cursor = 0;
    tween._phase = 1;
    tween._repeatsLeft = Math.max(tween.tweenInfo.repeatCount, 0);
    tween._delayLeft = tween.tweenInfo.delayTime;
    tween.state = tween._delayLeft > 0 ? "Delayed" : "Playing";
    tween._active = true;
    active.push(tween);
  }

  function pause(tween) {
    if (tween.state !== "Playing" && tween.state !== "Delayed") return;
    removeFromActive(tween);
    tween.state = "Paused";
  }

  function cancel(tween) {
    if (tween.state === "Begin" || tween.state === "Completed" || tween.state === "Cancelled") return;


    finish(tween, "Cancelled", false);
  }

  function create(inst, info, pairs) {
    if (!inst || inst.__isInstance !== true) {
      throw new LuaError("TweenService:Create espera uma Instance como primeiro argumento");
    }
    if (inst.isDestroyed()) {
      throw new LuaError("TweenService:Create: a Instance j\u00e1 foi destru\u00edda");
    }
    if (!info || info.__ud !== "TweenInfo") {
      throw new LuaError("TweenService:Create espera um TweenInfo como segundo argumento");
    }
    if (!pairs || pairs.length === 0) {
      throw new LuaError("TweenService:Create: o propertyTable deve conter ao menos uma propriedade");
    }


    if (dataModel) {
      let root = inst;
      while (root.getParent && root.getParent()) root = root.getParent();
      if (root !== inst && root !== dataModel && root.className === "DataModel") {
        throw new LuaError("TweenService:Create: a Instance n\u00e3o pertence ao DataModel do jogo");
      }
    }
    const entries = [];
    const seen = new Set();
    for (const pair of pairs) {
      const name = pair.name;
      const value = pair.value;
      if (typeof name !== "string") {
        throw new LuaError("TweenService:Create: as chaves do propertyTable devem ser nomes de propriedades (string)");
      }
      let propName = name;
      let target = null;
      if (!inst.hasProperty(name)) {

        if (name === "CFrame" && inst.hasProperty("Position")) {
          propName = "Position";
          if (!value || value.__ud !== "CFrame") {
            throw new LuaError("TweenService:Create: o valor alvo de 'CFrame' deve ser um CFrame");
          }
          target = { x: num(value.x), y: num(value.y), z: num(value.z) };
        } else {
          throw new LuaError(`TweenService:Create: '${name}' n\u00e3o \u00e9 uma propriedade de ${inst.className} "${inst.name}"`);
        }
      }
      const slot = inst._props ? inst._props.get(propName) : null;
      const def = slot && slot.def ? slot.def : {};
      if (def.readOnly) {
        throw new LuaError(`TweenService:Create: a propriedade '${name}' de ${inst.className} \u00e9 somente leitura e n\u00e3o pode ser tweenada`);
      }
      const type = def.type;
      if (!INTERPOLATORS[type]) {
        const label = NON_TWEENABLE_LABEL[type] || String(type);
        throw new LuaError(`TweenService cannot tween property of type ${label} ('${name}')`);
      }
      if (target === null) target = convertTarget(type, name, value);
      if (seen.has(propName)) {
        throw new LuaError(`TweenService:Create: propriedade duplicada '${propName}' no propertyTable`);
      }
      seen.add(propName);
      entries.push({ name: propName, type, target, start: null });
    }
    const tween = {
      __ud: "Tween",
      instance: inst,
      tweenInfo: info,
      state: "Begin",
      _entries: entries,
      _cursor: 0,
      _phase: 1,                                  
      _repeatsLeft: Math.max(info.repeatCount, 0),
      _delayLeft: info.delayTime,
      _active: false,
      _completed: scheduler ? new Signal(scheduler, "Completed") : null,
    };
    tween.play = () => play(tween);
    tween.pause = () => pause(tween);
    tween.cancel = () => cancel(tween);
    return tween;
  }

  function dispose() {
    disposed = true;
    for (const tween of active) {
      tween._active = false;
      tween.state = "Cancelled";
    }
    active.length = 0;
    byProperty.clear();
  }

  return {
    create,
    play,
    pause,
    cancel,
    step,
    dispose,
    get activeCount() {
      return active.length;
    },
  };
}
