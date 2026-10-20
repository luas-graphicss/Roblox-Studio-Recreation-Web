import { LuaError, LuaTable } from "./lua/interpreter.js";
import { Signal } from "./scheduler.js";
import { bus } from "../core/eventBus.js";
import { Events, Enums } from "../datamodel/index.js";


import { TOKENS as RBX_TOKENS } from "../interop/rbxTypeMaps.js";


const DIGIT_NAMES = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

function buildKeyCodeValues() {
  const v = {
    Unknown: 0, Backspace: 8, Tab: 9, Return: 13, Escape: 27, Space: 32,
    Quote: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47,
    Semicolon: 59, Equals: 61,
    LeftBracket: 91, BackSlash: 92, RightBracket: 93, Backquote: 96,
    Delete: 127,
    KeypadDecimal: 266, KeypadDivide: 267, KeypadMultiply: 268,
    KeypadMinus: 269, KeypadPlus: 270, KeypadEnter: 271,
    Up: 273, Down: 274, Right: 275, Left: 276,
    Insert: 277, Home: 278, End: 279, PageUp: 280, PageDown: 281,
    NumLock: 300, CapsLock: 301, ScrollLock: 302,
    RightShift: 303, LeftShift: 304, RightControl: 305, LeftControl: 306,
    RightAlt: 307, LeftAlt: 308, LeftSuper: 311, RightSuper: 312,
    ButtonX: 1000, ButtonY: 1001, ButtonA: 1002, ButtonB: 1003,
    ButtonR1: 1004, ButtonL1: 1005, ButtonR2: 1006, ButtonL2: 1007,
    ButtonR3: 1008, ButtonL3: 1009, ButtonStart: 1010, ButtonSelect: 1011,
    DPadLeft: 1012, DPadRight: 1013, DPadUp: 1014, DPadDown: 1015,
    Thumbstick1: 1016, Thumbstick2: 1017,
  };
  for (let i = 0; i < 26; i++) v[String.fromCharCode(65 + i)] = 97 + i;                  
  for (let i = 0; i < 10; i++) {
    v[DIGIT_NAMES[i]] = 48 + i;                       
    v["Keypad" + DIGIT_NAMES[i]] = 256 + i;                                     
  }
  for (let i = 1; i <= 12; i++) v["F" + i] = 281 + i;                      
  return Object.freeze(v);
}

export const KEYCODE_VALUES = buildKeyCodeValues();

function buildUserInputTypeValues() {
  const v = {
    MouseButton1: 0, MouseButton2: 1, MouseButton3: 2, MouseWheel: 3,
    MouseMovement: 4, Touch: 7, Keyboard: 8, Focus: 9,
    Accelerometer: 10, Gyro: 11,
    TextInput: 20, InputMethod: 21, None: 22,
  };
  for (let i = 1; i <= 8; i++) v["Gamepad" + i] = 11 + i;                        
  return Object.freeze(v);
}

export const USER_INPUT_TYPE_VALUES = buildUserInputTypeValues();

export const CONTEXT_ACTION_PRIORITY_VALUES = Object.freeze({
  Low: 1000, Medium: 2000, Default: 2000, High: 3000,
});


export const HUMANOID_STATE_VALUES = Object.freeze({
  FallingDown: 0, Ragdoll: 1, GettingUp: 2, Jumping: 3, Swimming: 4,
  Freefall: 5, Flying: 6, Landed: 7, Running: 8, RunningNoPhysics: 10,
  StrafingNoPhysics: 11, Climbing: 12, Seated: 13, PlatformStanding: 14,
  Dead: 15, Physics: 16, None: 18,
});


const RENDER_PRIORITY_VALUES = Object.freeze({
  First: 0, Input: 100, Camera: 200, Character: 300,
  Control: 400, Reflection: 500, Last: 2000,
});

export const ENUM_VALUE_OVERRIDES = Object.freeze({
  KeyCode: KEYCODE_VALUES,
  UserInputType: USER_INPUT_TYPE_VALUES,
  ContextActionPriority: CONTEXT_ACTION_PRIORITY_VALUES,
  HumanoidStateType: HUMANOID_STATE_VALUES,
  RenderPriority: RENDER_PRIORITY_VALUES,

  Material: RBX_TOKENS.Material.toRbx,
});


const enumItemCache = new Map();
export function enumItemFor(enumType, name) {
  const key = enumType + "." + name;
  let item = enumItemCache.get(key);
  if (item) return item;
  const ov = ENUM_VALUE_OVERRIDES[enumType];
  let value = ov && ov[name] != null ? ov[name] : -1;
  if (value < 0) {
    const items = Enums[enumType] || [];
    value = items.indexOf(name);
    if (value < 0) value = 0;
  }
  item = { __ud: "EnumItem", enumType, name, value };
  enumItemCache.set(key, item);
  return item;
}


function buildBrowserCodeMap() {
  const m = {
    Space: "Space", Enter: "Return", Escape: "Escape", Tab: "Tab",
    Backspace: "Backspace", Delete: "Delete",
    ShiftLeft: "LeftShift", ShiftRight: "RightShift",
    ControlLeft: "LeftControl", ControlRight: "RightControl",
    AltLeft: "LeftAlt", AltRight: "RightAlt",
    ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert",
    Comma: "Comma", Period: "Period", Semicolon: "Semicolon", Quote: "Quote",
    Slash: "Slash", Backslash: "BackSlash",
    BracketLeft: "LeftBracket", BracketRight: "RightBracket",
    Minus: "Minus", Equal: "Equals", Backquote: "Backquote",
    NumpadAdd: "KeypadPlus", NumpadSubtract: "KeypadMinus",
    NumpadMultiply: "KeypadMultiply", NumpadDivide: "KeypadDivide",
    NumpadDecimal: "KeypadDecimal", NumpadEnter: "KeypadEnter",
    CapsLock: "CapsLock", NumLock: "NumLock", ScrollLock: "ScrollLock",
    MetaLeft: "LeftSuper", MetaRight: "RightSuper",
  };
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    m["Key" + ch] = ch;
  }
  for (let i = 0; i < 10; i++) {
    m["Digit" + i] = DIGIT_NAMES[i];
    m["Numpad" + i] = "Keypad" + DIGIT_NAMES[i];
  }
  for (let i = 1; i <= 12; i++) m["F" + i] = "F" + i;
  return Object.freeze(m);
}

export const BROWSER_CODE_TO_KEYCODE = buildBrowserCodeMap();


export const GAMEPAD_BUTTONS = Object.freeze([
  "ButtonA", "ButtonB", "ButtonX", "ButtonY",
  "ButtonL1", "ButtonR1", "ButtonL2", "ButtonR2",
  "ButtonSelect", "ButtonStart", "ButtonL3", "ButtonR3",
  "DPadUp", "DPadDown", "DPadLeft", "DPadRight",
]);


const KEYCODE_BY_LOWER = new Map(Object.keys(KEYCODE_VALUES).map((n) => [n.toLowerCase(), n]));
const KEYCODE_BY_VALUE = new Map(Object.entries(KEYCODE_VALUES).map(([n, val]) => [val, n]));
const UIT_BY_LOWER = new Map(Object.keys(USER_INPUT_TYPE_VALUES).map((n) => [n.toLowerCase(), n]));
const UIT_BY_VALUE = new Map(Object.entries(USER_INPUT_TYPE_VALUES).map(([n, val]) => [val, n]));
const INPUT_STATES = ["Begin", "Change", "End", "Cancel", "None"];

function stripEnumPrefix(s, enumName) {
  const prefix = "Enum." + enumName + ".";
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

export function resolveKeyCodeName(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    if (v.__ud !== "EnumItem" || v.enumType !== "KeyCode") return null;
    return KEYCODE_BY_LOWER.get(String(v.name).toLowerCase()) || null;
  }
  if (typeof v === "number") return KEYCODE_BY_VALUE.get(v) || null;
  const s = stripEnumPrefix(String(v), "KeyCode");
  return KEYCODE_BY_LOWER.get(s.toLowerCase()) || null;
}

export function resolveUserInputTypeName(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    if (v.__ud !== "EnumItem" || v.enumType !== "UserInputType") return null;
    return UIT_BY_LOWER.get(String(v.name).toLowerCase()) || null;
  }
  if (typeof v === "number") return UIT_BY_VALUE.get(v) || null;
  const s = stripEnumPrefix(String(v), "UserInputType");
  return UIT_BY_LOWER.get(s.toLowerCase()) || null;
}

export function resolveUserInputStateName(v) {
  if (v == null) return null;
  if (typeof v === "object") {
    if (v.__ud !== "EnumItem" || v.enumType !== "UserInputState") return null;
    return INPUT_STATES.includes(v.name) ? v.name : null;
  }
  if (typeof v === "number") return INPUT_STATES[v] || null;
  const s = stripEnumPrefix(String(v), "UserInputState");
  const hit = INPUT_STATES.find((n) => n.toLowerCase() === s.toLowerCase());
  return hit || null;
}


function vec3(x, y, z) {
  return { x: Number(x) || 0, y: Number(y) || 0, z: Number(z) || 0 };
}

export function makeInputObject(userInputType, keyCode, userInputState, pos, delta) {
  return {
    __ud: "InputObject",
    userInputType: userInputType || "None",
    keyCode: keyCode || "Unknown",
    userInputState: userInputState || "None",
    position: vec3(pos && pos.x, pos && pos.y, pos && pos.z),
    delta: vec3(delta && delta.x, delta && delta.y, delta && delta.z),
  };
}


const DEADZONE = 0.1;                                    
const ANALOG_THRESHOLD = 0.05;                                                 
const MAX_BOUND_ACTIONS = 50;                                          
const MAX_QUEUE = 1000;                                                  
const DEFAULT_PRIORITY = 2000;

const TAP_MAX_MS = 500;
const TAP_MAX_DIST = 15;

const UIS_EVENTS = new Set([
  "InputBegan", "InputChanged", "InputEnded",
  "TouchStarted", "TouchEnded", "TouchMoved", "TouchTap",
  "JumpRequest",
  "GamepadConnected", "GamepadDisconnected",
  "WindowFocused", "WindowFocusReleased",
  "TextBoxFocused", "TextBoxFocusReleased",
  "MouseMoved", "MouseWheelForward", "MouseWheelBackward",
]);
const CAS_EVENTS = new Set(["LocalToolEquipped", "LocalToolUnequipped"]);

const ZERO = () => ({ x: 0, y: 0, z: 0 });

export function createInputManager(options = {}) {
  const scheduler = options.scheduler;
  const logger = options.logger || null;
  const dataModel = options.dataModel || null;
  const getMode = options.getMode || (() => "run");
  const warn = (msg) => { if (logger && logger.warn) logger.warn(msg, { source: "Studio" }); };


  let luaCall = null;
  let disposed = false;


  const signals = new Map();
  function signalNamed(name) {
    let s = signals.get(name);
    if (!s) { s = new Signal(scheduler, name); signals.set(name, s); }
    return s;
  }
  function uisSignal(name) { return UIS_EVENTS.has(name) ? signalNamed(name) : null; }
  function casSignal(name) { return CAS_EVENTS.has(name) ? signalNamed(name) : null; }
  function fireSignal(name, args) {
    const s = signals.get(name);
    if (s) s.fire(args || []);
  }


  const keysDown = new Map();                                       
  const mouseDown = new Map();                                            
  let mousePos = { x: 0, y: 0 };
  let frameDelta = { x: 0, y: 0 };                               
  let lastFrameDelta = { x: 0, y: 0 };                            
  let pendingMove = null;                                                
  let queue = [];
  const viewport = { w: 800, h: 600 };
  let focusedTextBox = null;
  const gamepads = new Map();                                                    
  const touches = new Map();               
  let windowFocused = true;
  let actionSeq = 0;
  const actions = new Map();                  
  let actionOrder = [];                                       
  let domState = null;

  function inputsActive() {

    const m = getMode();
    return !disposed && (m === "play" || m === "run");
  }


  let uisCache = null;
  function uisInst() {
    if (uisCache && !(uisCache.isDestroyed && uisCache.isDestroyed())) return uisCache;
    uisCache = null;
    if (dataModel && dataModel.getChildren) {
      uisCache = dataModel.getChildren().find((c) => c.className === "UserInputService") || null;
    }
    return uisCache;
  }
  function uisProp(name, def) {
    const u = uisInst();
    if (!u || !u.hasProperty(name)) return def;
    const v = u.getProperty(name);
    return v == null ? def : v;
  }
  function setUisFlag(name, value) {
    const u = uisInst();
    if (u && u.hasProperty(name) && typeof u._setInternal === "function") u._setInternal(name, value);
  }

  function clampPos(x, y) {

    return {
      x: Math.min(Math.max(Number(x) || 0, 0), viewport.w),
      y: Math.min(Math.max(Number(y) || 0, 0), viewport.h),
    };
  }
  function setViewportSize(w, h) {
    if (Number(w) > 0) viewport.w = Number(w);
    if (Number(h) > 0) viewport.h = Number(h);
  }

  function pushEvent(rec) {
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push(rec);
  }


  function textBoxAlive() {
    if (focusedTextBox && focusedTextBox.isDestroyed && focusedTextBox.isDestroyed()) focusedTextBox = null;
    return !!focusedTextBox;
  }
  function setFocusedTextBox(inst) {
    const prev = textBoxAlive() ? focusedTextBox : null;
    const next = inst || null;
    if (next === prev) return;
    if (prev) {
      focusedTextBox = null;
      pushEvent({ kind: "signal", name: "TextBoxFocusReleased", args: [prev] });
    }
    if (next) {
      focusedTextBox = next;
      try {
        if (next.hasProperty && next.hasProperty("ClearTextOnFocus") && next.getProperty("ClearTextOnFocus") === true) {
          next.setProperty("Text", "");
        }
      } catch (_) {            }
      pushEvent({ kind: "signal", name: "TextBoxFocused", args: [next] });
    }
  }
  function getFocusedTextBox() {
    return textBoxAlive() ? focusedTextBox : null;
  }


  function handleKeyForTextBox(name, opts) {
    if (!textBoxAlive()) return false;
    const tb = focusedTextBox;
    try {
      if (name === "Escape") {
        setFocusedTextBox(null);                     
      } else if (name === "Return" && tb.getProperty("MultiLine") !== true) {
        setFocusedTextBox(null);
      } else if (name === "Backspace") {
        const t = String(tb.getProperty("Text") || "");
        tb.setProperty("Text", t.slice(0, -1));
      } else if (opts && typeof opts.text === "string" && opts.text.length === 1) {
        tb.setProperty("Text", String(tb.getProperty("Text") || "") + opts.text);
      }
    } catch (_) {            }
    return true;                                                      
  }


  function keyDown(keyLike, opts = {}) {
    if (!inputsActive()) return false;

    const name = resolveKeyCodeName(keyLike) || "Unknown";

    if (name !== "Unknown" && keysDown.has(name)) return false;
    const gp = handleKeyForTextBox(name, opts);
    const obj = makeInputObject("Keyboard", name, "Begin", { x: mousePos.x, y: mousePos.y, z: 0 }, ZERO());
    if (name !== "Unknown") keysDown.set(name, obj);
    pushEvent({ kind: "input", state: "Begin", uit: "Keyboard", keyCode: name, obj, gameProcessed: gp });


    if (name === "Space" && !gp) pushEvent({ kind: "signal", name: "JumpRequest", args: [] });
    return true;
  }

  function keyUp(keyLike) {
    if (!inputsActive()) return false;
    const name = resolveKeyCodeName(keyLike) || "Unknown";
    if (name !== "Unknown" && !keysDown.has(name)) return false;
    keysDown.delete(name);
    const gp = textBoxAlive();
    const obj = makeInputObject("Keyboard", name, "End", { x: mousePos.x, y: mousePos.y, z: 0 }, ZERO());
    pushEvent({ kind: "input", state: "End", uit: "Keyboard", keyCode: name, obj, gameProcessed: gp });
    return true;
  }


  function mouseButton(idx, down, x, y, opts = {}) {
    if (!inputsActive()) return false;
    const uit = idx === 1 ? "MouseButton2" : idx === 2 ? "MouseButton3" : "MouseButton1";
    if (x != null && y != null) mousePos = clampPos(x, y);
    const gp = !!opts.gameProcessed;                                         
    if (down) {
      if (mouseDown.has(uit)) return false;
      if (textBoxAlive() && !opts.onTextBox) setFocusedTextBox(null);                           
      const obj = makeInputObject(uit, "Unknown", "Begin", { x: mousePos.x, y: mousePos.y, z: 0 }, ZERO());
      mouseDown.set(uit, obj);
      pushEvent({ kind: "input", state: "Begin", uit, keyCode: "Unknown", obj, gameProcessed: gp });
    } else {
      if (!mouseDown.has(uit)) return false;
      mouseDown.delete(uit);
      const obj = makeInputObject(uit, "Unknown", "End", { x: mousePos.x, y: mousePos.y, z: 0 }, ZERO());
      pushEvent({ kind: "input", state: "End", uit, keyCode: "Unknown", obj, gameProcessed: gp });
    }
    return true;
  }

  function mouseMove(x, y, dx, dy) {
    if (!inputsActive()) return false;
    const behavior = String(uisProp("MouseBehavior", "Default"));
    if (behavior === "LockCenter") {
      mousePos = { x: viewport.w / 2, y: viewport.h / 2 };
    } else if (behavior !== "LockCurrentPosition" && x != null && y != null) {
      mousePos = clampPos(x, y);
    }
    const mdx = Number(dx) || 0;
    const mdy = Number(dy) || 0;
    frameDelta.x += mdx;
    frameDelta.y += mdy;

    if (pendingMove) {
      pendingMove.x = mousePos.x; pendingMove.y = mousePos.y;
      pendingMove.dx += mdx; pendingMove.dy += mdy;
    } else {
      pendingMove = { x: mousePos.x, y: mousePos.y, dx: mdx, dy: mdy };
    }
    return true;
  }


  function wheel(dz, x, y) {
    if (!inputsActive()) return false;
    const z = Number(dz) > 0 ? 1 : -1;
    if (x != null && y != null) mousePos = clampPos(x, y);
    const obj = makeInputObject("MouseWheel", "Unknown", "Change", { x: mousePos.x, y: mousePos.y, z }, { x: 0, y: 0, z });
    pushEvent({ kind: "input", state: "Change", uit: "MouseWheel", keyCode: "Unknown", obj, gameProcessed: false });
    return true;
  }


  function touch(id, phase, x, y) {
    if (!inputsActive()) return false;
    const tid = String(id == null ? 0 : id);
    const p = clampPos(x, y);
    const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    let state;
    let delta = { x: 0, y: 0, z: 0 };
    let tapped = false;
    if (phase === "start") {
      if (touches.has(tid)) return false;
      touches.set(tid, { x: p.x, y: p.y, startX: p.x, startY: p.y, startT: now, moved: false });
      state = "Begin";
    } else if (phase === "move") {
      const last = touches.get(tid);
      if (!last) return false;
      delta = { x: p.x - last.x, y: p.y - last.y, z: 0 };
      last.x = p.x;
      last.y = p.y;

      if (Math.hypot(p.x - last.startX, p.y - last.startY) > TAP_MAX_DIST) last.moved = true;
      state = "Change";
    } else {
      const rec = touches.get(tid);
      if (!rec) return false;
      touches.delete(tid);
      state = phase === "cancel" ? "Cancel" : "End";

      tapped = state === "End" && !rec.moved &&
        now - (rec.startT || 0) <= TAP_MAX_MS &&
        Math.hypot(p.x - (rec.startX != null ? rec.startX : p.x), p.y - (rec.startY != null ? rec.startY : p.y)) <= TAP_MAX_DIST;
    }
    const obj = makeInputObject("Touch", "Unknown", state, { x: p.x, y: p.y, z: 0 }, delta);
    pushEvent({ kind: "input", state, uit: "Touch", keyCode: "Unknown", obj, gameProcessed: false });
    if (tapped) {


      const positions = new LuaTable();
      positions.rawset(1, { __ud: "Vector2", x: p.x, y: p.y });
      pushEvent({ kind: "signal", name: "TouchTap", args: [positions, false] });
    }
    return true;
  }


  function cancelPressed() {
    for (const [name, prev] of keysDown) {
      const obj = makeInputObject("Keyboard", name, "Cancel", prev.position, ZERO());
      pushEvent({ kind: "input", state: "Cancel", uit: "Keyboard", keyCode: name, obj, gameProcessed: false });
    }
    keysDown.clear();
    for (const [uit] of mouseDown) {
      const obj = makeInputObject(uit, "Unknown", "Cancel", { x: mousePos.x, y: mousePos.y, z: 0 }, ZERO());
      pushEvent({ kind: "input", state: "Cancel", uit, keyCode: "Unknown", obj, gameProcessed: false });
    }
    mouseDown.clear();
    for (const [tid, p] of touches) {
      const obj = makeInputObject("Touch", "Unknown", "Cancel", { x: p.x, y: p.y, z: 0 }, ZERO());
      pushEvent({ kind: "input", state: "Cancel", uit: "Touch", keyCode: "Unknown", obj, gameProcessed: false });
    }
    touches.clear();
  }

  function windowFocusChange(focused) {
    if (!inputsActive()) return false;
    const f = !!focused;
    if (f === windowFocused) return false;
    windowFocused = f;
    if (f) {
      pushEvent({ kind: "signal", name: "WindowFocused", args: [] });
    } else {
      cancelPressed();                                                    
      pushEvent({ kind: "signal", name: "WindowFocusReleased", args: [] });
    }
    return true;
  }


  function gamepadConnect(n) {
    if (!inputsActive()) return false;
    const num = Math.max(1, Math.min(8, Math.floor(Number(n) || 1)));
    if (gamepads.has(num)) return false;
    gamepads.set(num, { buttons: new Map(), sticks: { 1: { x: 0, y: 0 }, 2: { x: 0, y: 0 } } });
    setUisFlag("GamepadEnabled", true);
    pushEvent({ kind: "signal", name: "GamepadConnected", args: [num] });
    return true;
  }

  function gamepadDisconnect(n) {
    const num = Number(n);
    const pad = gamepads.get(num);
    if (!pad) return false;
    for (const [btn] of pad.buttons) {
      const obj = makeInputObject("Gamepad" + num, btn, "Cancel", ZERO(), ZERO());
      pushEvent({ kind: "input", state: "Cancel", uit: "Gamepad" + num, keyCode: btn, obj, gameProcessed: false });
    }
    gamepads.delete(num);
    setUisFlag("GamepadEnabled", gamepads.size > 0);
    pushEvent({ kind: "signal", name: "GamepadDisconnected", args: [num] });
    return true;
  }

  function gamepadButton(n, keyLike, down) {
    if (!inputsActive()) return false;
    const num = Number(n);
    const pad = gamepads.get(num);
    if (!pad) return false;
    const name = resolveKeyCodeName(keyLike);
    if (!name || (KEYCODE_VALUES[name] || 0) < 1000) return false;                            
    const cur = pad.buttons.has(name);
    if (cur === !!down) return false;
    const state = down ? "Begin" : "End";
    const obj = makeInputObject("Gamepad" + num, name, state, ZERO(), ZERO());
    if (down) pad.buttons.set(name, obj);
    else pad.buttons.delete(name);
    pushEvent({ kind: "input", state, uit: "Gamepad" + num, keyCode: name, obj, gameProcessed: false });

    if (down && name === "ButtonA") pushEvent({ kind: "signal", name: "JumpRequest", args: [] });
    return true;
  }

  function gamepadStick(n, stickIdx, x, y) {
    if (!inputsActive()) return false;
    const num = Number(n);
    const pad = gamepads.get(num);
    if (!pad) return false;
    const idx = Number(stickIdx) === 2 ? 2 : 1;
    let vx = Number(x) || 0;
    let vy = Number(y) || 0;
    if (Math.hypot(vx, vy) < DEADZONE) { vx = 0; vy = 0; }                
    const last = pad.sticks[idx];

    if (Math.abs(vx - last.x) < ANALOG_THRESHOLD && Math.abs(vy - last.y) < ANALOG_THRESHOLD) return false;
    const delta = { x: vx - last.x, y: vy - last.y, z: 0 };
    pad.sticks[idx] = { x: vx, y: vy };
    const obj = makeInputObject("Gamepad" + num, "Thumbstick" + idx, "Change", { x: vx, y: vy, z: 0 }, delta);
    pushEvent({ kind: "input", state: "Change", uit: "Gamepad" + num, keyCode: "Thumbstick" + idx, obj, gameProcessed: false });
    return true;
  }

  function sendKeyAction(stateLike, keyLike) {
    const st = resolveUserInputStateName(stateLike);
    if (st === "Begin") return keyDown(keyLike);
    if (st === "End") return keyUp(keyLike);
    warn("UserInputService.SendKeyAction: estado invalido (use Begin ou End).");
    return false;
  }


  function clampPriority(v) {
    if (v == null) return DEFAULT_PRIORITY;
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "object" && v.__ud === "EnumItem" && v.enumType === "ContextActionPriority") {
      return CONTEXT_ACTION_PRIORITY_VALUES[v.name] != null ? CONTEXT_ACTION_PRIORITY_VALUES[v.name] : DEFAULT_PRIORITY;
    }
    const n = Number(v);
    return isFinite(n) ? n : DEFAULT_PRIORITY;
  }

  function rebuildActionOrder() {

    actionOrder = [...actions.values()].sort((a, b) => (b.priority - a.priority) || (b.seq - a.seq));
  }

  function bindAction(spec) {
    const name = String(spec.name == null ? "" : spec.name);
    if (!name) throw new LuaError("BindAction: o nome da action deve ser uma string nao vazia", 2);
    const cb = spec.callback;
    if (cb == null || (typeof cb !== "object" && typeof cb !== "function")) {
      throw new LuaError("BindAction: o segundo argumento deve ser uma funcao", 2);
    }
    const existed = actions.has(name);
    if (!existed && actions.size >= MAX_BOUND_ACTIONS) {

      warn("ContextActionService: limite de " + MAX_BOUND_ACTIONS + " actions atingido; '" + name + "' foi ignorada.");
      return null;
    }
    if (existed) {

      warn("ContextActionService: a action '" + name + "' ja existia e foi sobrescrita.");
    }
    const inputKeys = new Set();
    const inputItems = [];
    for (const raw of spec.inputs || []) {
      if (raw == null) continue;
      if (typeof raw === "object" && raw.__ud === "EnumItem" && raw.enumType === "UserInputType") {
        const ut = resolveUserInputTypeName(raw);
        if (ut) { inputKeys.add("ut:" + ut); inputItems.push({ enumType: "UserInputType", name: ut }); continue; }
      }
      const kc = resolveKeyCodeName(raw);
      if (kc) { inputKeys.add("kc:" + kc); inputItems.push({ enumType: "KeyCode", name: kc }); continue; }
      const ut2 = resolveUserInputTypeName(raw);
      if (ut2) { inputKeys.add("ut:" + ut2); inputItems.push({ enumType: "UserInputType", name: ut2 }); continue; }
      warn("ContextActionService: input invalido ignorado em '" + name + "'.");
    }
    const action = {
      name,
      callback: cb,
      createTouchButton: spec.createTouchButton === true,
      priority: clampPriority(spec.priority),
      seq: ++actionSeq,
      inputKeys,
      inputItems,
      title: null,                                                         
    };
    actions.set(name, action);
    rebuildActionOrder();
    return action;
  }

  function unbindAction(name) {
    const removed = actions.delete(String(name));
    if (removed) rebuildActionOrder();
    return removed;
  }
  function unbindAllActions() {
    actions.clear();
    actionOrder = [];
  }
  function getAction(name) {
    return actions.get(String(name)) || null;
  }
  function getBoundActionInfo(name) {
    return actions.get(String(name)) || null;
  }
  function getAllBoundActionInfo() {
    return [...actions.values()];
  }


  function setActionTitle(name, title) {
    const a = actions.get(String(name));
    if (!a) {
      warn("ContextActionService.SetTitle: a action '" + String(name) + "' nao esta vinculada.");
      return false;
    }
    a.title = title == null ? null : String(title);
    return true;
  }

  function matchActions(rec) {
    if (!actionOrder.length) return [];
    const kKc = rec.keyCode && rec.keyCode !== "Unknown" ? "kc:" + rec.keyCode : null;
    const kUt = "ut:" + rec.uit;
    return actionOrder.filter((a) => (kKc && a.inputKeys.has(kKc)) || a.inputKeys.has(kUt));
  }

  function isPassResult(v) {
    if (v == null) return false;                                           
    if (typeof v === "string") return v === "Pass";
    if (typeof v === "object" && v.__ud === "EnumItem" && v.enumType === "ContextActionResult") {
      return v.name === "Pass";
    }
    return false;
  }


  function fireUisFor(rec, obj) {
    const gp = !!rec.gameProcessed;
    const evt = rec.state === "Begin" ? "InputBegan" : rec.state === "Change" ? "InputChanged" : "InputEnded";
    fireSignal(evt, [obj, gp]);
    if (rec.uit === "Touch") {
      const t = rec.state === "Begin" ? "TouchStarted" : rec.state === "Change" ? "TouchMoved" : "TouchEnded";
      fireSignal(t, [obj, gp]);
    }
    if (rec.uit === "MouseMovement" && rec.state === "Change") fireSignal("MouseMoved", [obj]);
    if (rec.uit === "MouseWheel") fireSignal(obj.position.z > 0 ? "MouseWheelForward" : "MouseWheelBackward", [obj]);
  }

  function* casChain(matches, rec, obj) {
    let sunk = false;
    const stateItem = enumItemFor("UserInputState", rec.state);
    for (const a of matches) {
      if (actions.get(a.name) !== a) continue;                                                 
      let v;
      try {
        const res = yield* luaCall(a.callback, [a.name, stateItem, obj]);
        v = Array.isArray(res) ? res[0] : res;
      } catch (e) {

        warn("ContextActionService: erro na action '" + a.name + "': " + ((e && (e.luaMessage || e.message)) || e));
        v = enumItemFor("ContextActionResult", "Pass");
      }
      if (isPassResult(v)) continue;
      sunk = true;                                 
      break;
    }


    if (sunk) fireUisFor({ ...rec, gameProcessed: true }, obj);
    else fireUisFor(rec, obj);
  }

  function dispatch(rec) {
    if (rec.kind === "signal") {
      fireSignal(rec.name, rec.args);
      return;
    }
    const matches = matchActions(rec);
    if (matches.length && luaCall && scheduler && typeof scheduler.spawnGen === "function") {
      scheduler.spawnGen(casChain(matches, rec, rec.obj), "cas:" + (rec.keyCode !== "Unknown" ? rec.keyCode : rec.uit));
    } else {
      fireUisFor(rec, rec.obj);
    }
  }


  function step() {
    if (disposed) return;
    if (domState) pollGamepads();                                                   
    if (pendingMove) {
      const m = pendingMove;
      pendingMove = null;
      const obj = makeInputObject("MouseMovement", "Unknown", "Change", { x: m.x, y: m.y, z: 0 }, { x: m.dx, y: m.dy, z: 0 });
      pushEvent({ kind: "input", state: "Change", uit: "MouseMovement", keyCode: "Unknown", obj, gameProcessed: false });
    }
    lastFrameDelta = frameDelta;
    frameDelta = { x: 0, y: 0 };
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    for (const rec of batch) {
      try {
        dispatch(rec);
      } catch (e) {
        warn("Input: erro ao despachar evento: " + ((e && e.message) || e));
      }
    }
  }


  function getKeysPressed() { return [...keysDown.values()]; }
  function getMouseButtonsPressed() { return [...mouseDown.values()]; }
  function getMouseLocation() { return { x: mousePos.x, y: mousePos.y }; }
  function getMouseDelta() {


    const behavior = String(uisProp("MouseBehavior", "Default"));
    if (behavior === "Default") return { x: 0, y: 0 };
    let s = Number(uisProp("MouseDeltaSensitivity", 1));
    if (!isFinite(s)) s = 1;
    s = Math.min(Math.max(s, 0), 10);                                    
    return { x: lastFrameDelta.x * s, y: lastFrameDelta.y * s };
  }
  function isKeyDown(v) {
    const name = resolveKeyCodeName(v);
    return name ? keysDown.has(name) : false;
  }
  function isMouseButtonPressed(v) {
    const ut = resolveUserInputTypeName(v);
    return ut ? mouseDown.has(ut) : false;
  }
  function getGamepadConnected(n) { return gamepads.has(Number(n)); }
  function getConnectedGamepads() { return [...gamepads.keys()].sort((a, b) => a - b); }
  function getGamepadState(n) {
    const pad = gamepads.get(Number(n));
    if (!pad) return [];
    const out = [...pad.buttons.values()];
    for (const idx of [1, 2]) {
      const s = pad.sticks[idx];
      out.push(makeInputObject("Gamepad" + Number(n), "Thumbstick" + idx, "Change", { x: s.x, y: s.y, z: 0 }, ZERO()));
    }
    return out;
  }


  function pollGamepads() {
    const win = domState && domState.win;
    const nav = win && win.navigator;
    if (!nav || typeof nav.getGamepads !== "function") return;
    let pads;
    try { pads = nav.getGamepads(); } catch (_) { return; }
    if (!pads) return;
    for (let i = 0; i < pads.length && i < 8; i++) {
      const pad = pads[i];
      const n = i + 1;
      if (!pad || pad.connected === false) {
        if (gamepads.has(n)) gamepadDisconnect(n);
        continue;
      }
      if (!gamepads.has(n)) gamepadConnect(n);

      if (pad.mapping && pad.mapping !== "standard") continue;
      const btns = pad.buttons || [];
      const padState = gamepads.get(n);
      for (let b = 0; b < btns.length && b < GAMEPAD_BUTTONS.length; b++) {
        const pressed = !!(btns[b] && (btns[b].pressed || Number(btns[b].value) > 0.5));
        if (pressed !== padState.buttons.has(GAMEPAD_BUTTONS[b])) {
          gamepadButton(n, GAMEPAD_BUTTONS[b], pressed);
        }
      }
      const ax = pad.axes || [];
      gamepadStick(n, 1, Number(ax[0]) || 0, -(Number(ax[1]) || 0));                                        
      gamepadStick(n, 2, Number(ax[2]) || 0, -(Number(ax[3]) || 0));
    }
  }

  function attach(opts = {}) {
    if (domState || disposed) return false;
    if (typeof window === "undefined" || typeof document === "undefined") return false;
    const doc = opts.doc || document;
    const win = opts.win || window;
    const el = opts.canvas || doc.querySelector(".rsw-viewport__canvas") || null;


    const hasTouch = ("ontouchstart" in win) || !!(win.navigator && win.navigator.maxTouchPoints > 0);
    setUisFlag("KeyboardEnabled", true);
    setUisFlag("MouseEnabled", true);
    setUisFlag("TouchEnabled", hasTouch);

    const st = { doc, win, el, handlers: [], busOff: null, prevTabIndex: null, prevOutline: "", prevCursor: "" };
    const on = (target, type, fn, opts2) => {
      if (!target || !target.addEventListener) return;
      target.addEventListener(type, fn, opts2);
      st.handlers.push(() => target.removeEventListener(type, fn, opts2));
    };

    const rectOf = () => {
      try {
        const r = el ? el.getBoundingClientRect() : null;
        if (r && r.width > 0) { viewport.w = r.width; viewport.h = r.height; return r; }
      } catch (_) {            }
      return { left: 0, top: 0, width: viewport.w, height: viewport.h };
    };
    const relPos = (ev) => { const r = rectOf(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    const overEl = (ev) => {
      const r = rectOf();
      return ev.clientX >= r.left && ev.clientX <= r.left + r.width && ev.clientY >= r.top && ev.clientY <= r.top + r.height;
    };
    const isLocked = () => !!(el && doc.pointerLockElement === el);
    const viewportFocused = () => !!(el && (el === doc.activeElement || (el.contains && el.contains(doc.activeElement)) || isLocked()));
    const isEditorTypingTarget = (t) =>
      !!(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable));


    if (el) {
      st.prevTabIndex = el.getAttribute ? el.getAttribute("tabindex") : null;
      el.tabIndex = 0;
      st.prevOutline = el.style.outline || "";
      st.prevCursor = el.style.cursor || "";
      el.style.outline = "none";
      on(el, "focus", () => { el.style.boxShadow = "inset 0 0 0 1px rgba(110, 180, 255, 0.6)"; });
      on(el, "blur", () => { el.style.boxShadow = ""; });
    }

    const applyMouseBehavior = () => {
      if (!el) return;
      const behavior = String(uisProp("MouseBehavior", "Default"));
      if (behavior === "LockCenter" || behavior === "LockCurrentPosition") {

        if (getMode() === "play" && viewportFocused() && !isLocked() && el.requestPointerLock) {
          try { el.requestPointerLock(); } catch (_) {            }
        }
      } else if (isLocked() && doc.exitPointerLock) {
        try { doc.exitPointerLock(); } catch (_) {            }
      }
    };
    const applyCursor = () => {
      if (!el) return;
      el.style.cursor = uisProp("MouseIconEnabled", true) === false ? "none" : st.prevCursor;
    };


    on(doc, "keydown", (e) => {
      if (isEditorTypingTarget(e.target)) return;                                  
      if (!viewportFocused()) return;                                         
      if (e.repeat) return;
      const name = BROWSER_CODE_TO_KEYCODE[e.code] || "Unknown";
      if (e.code === "Tab") e.preventDefault();                             
      keyDown(name, { text: e.key && e.key.length === 1 ? e.key : null });
    }, true);
    on(doc, "keyup", (e) => {
      if (isEditorTypingTarget(e.target)) return;
      const name = BROWSER_CODE_TO_KEYCODE[e.code] || "Unknown";
      keyUp(name);                                                    
    }, true);


    const BTN_MAP = { 0: 0, 1: 2, 2: 1 };                                    
    on(doc, "mousedown", (e) => {
      if (!overEl(e) && !isLocked()) return;
      if (el && el.focus) { try { el.focus(); } catch (_) {            } }
      const p = relPos(e);
      mouseButton(BTN_MAP[e.button] != null ? BTN_MAP[e.button] : 0, true, p.x, p.y);
      applyMouseBehavior();                                                    
    }, true);
    on(doc, "mouseup", (e) => {
      const p = relPos(e);
      mouseButton(BTN_MAP[e.button] != null ? BTN_MAP[e.button] : 0, false, p.x, p.y);
    }, true);
    on(doc, "mousemove", (e) => {
      if (!overEl(e) && !isLocked()) return;
      const p = relPos(e);
      mouseMove(p.x, p.y, Number(e.movementX) || 0, Number(e.movementY) || 0);
    }, true);
    if (el) {
      on(el, "wheel", (e) => {
        e.preventDefault();
        const p = relPos(e);
        wheel(e.deltaY < 0 ? 1 : -1, p.x, p.y);                                  
      }, { passive: false });
      on(el, "contextmenu", (e) => { e.preventDefault(); });
      const eachTouch = (e, phase) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
          const r = rectOf();
          touch(t.identifier, phase, t.clientX - r.left, t.clientY - r.top);
        }
      };
      on(el, "touchstart", (e) => eachTouch(e, "start"), { passive: false });
      on(el, "touchmove", (e) => eachTouch(e, "move"), { passive: false });
      on(el, "touchend", (e) => eachTouch(e, "end"), { passive: false });
      on(el, "touchcancel", (e) => eachTouch(e, "cancel"), { passive: false });
    }


    on(win, "blur", () => { windowFocusChange(false); });
    on(win, "focus", () => { windowFocusChange(true); });
    on(win, "gamepadconnected", (e) => { if (e.gamepad) gamepadConnect(e.gamepad.index + 1); });
    on(win, "gamepaddisconnected", (e) => { if (e.gamepad) gamepadDisconnect(e.gamepad.index + 1); });
    on(doc, "pointerlockchange", () => {

      if (!isLocked()) {
        const u = uisInst();
        if (u && String(uisProp("MouseBehavior", "Default")) !== "Default") {
          try { u.setProperty("MouseBehavior", "Default"); } catch (_) {            }
        }
      }
    });


    st.busOff = bus.on(Events.PropertyChanged, (p) => {
      if (!p || p.instance !== uisInst()) return;


      if (p.property === "MouseBehavior") applyMouseBehavior();
      else if (p.property === "MouseIconEnabled") applyCursor();
    });

    domState = st;
    rectOf();
    applyCursor();
    applyMouseBehavior();
    if (el && el.focus) { try { el.focus(); } catch (_) {            } }
    return true;
  }

  function detach() {
    if (!domState) return;
    const st = domState;
    domState = null;
    for (const off of st.handlers) {
      try { off(); } catch (_) {            }
    }
    if (st.busOff) { try { st.busOff(); } catch (_) {            } }
    if (st.el) {
      try {
        if (st.doc.pointerLockElement === st.el && st.doc.exitPointerLock) st.doc.exitPointerLock();
      } catch (_) {            }
      st.el.style.boxShadow = "";
      st.el.style.outline = st.prevOutline;
      st.el.style.cursor = st.prevCursor;
      if (st.prevTabIndex == null) { try { st.el.removeAttribute("tabindex"); } catch (_) {            } }
    }

    cancelPressed();
  }

  function setLuaCall(fn) { luaCall = typeof fn === "function" ? fn : null; }

  function dispose() {
    if (disposed) return;
    detach();
    disposed = true;
    queue = [];
    pendingMove = null;
    keysDown.clear();
    mouseDown.clear();
    touches.clear();
    gamepads.clear();
    actions.clear();
    actionOrder = [];
    focusedTextBox = null;
    luaCall = null;
    for (const s of signals.values()) {
      if (s.handlers) s.handlers.clear();
    }
    signals.clear();
  }

  return {

    step, attach, detach, dispose, setLuaCall, setViewportSize,

    uisSignal, casSignal,
    getKeysPressed, getMouseButtonsPressed, getMouseLocation, getMouseDelta,
    isKeyDown, isMouseButtonPressed, getFocusedTextBox, setFocusedTextBox,
    getGamepadConnected, getConnectedGamepads, getGamepadState, sendKeyAction,

    bindAction, unbindAction, unbindAllActions, getAction, getBoundActionInfo, getAllBoundActionInfo,
    setActionTitle,

    keyDown, keyUp, mouseButton, mouseMove, wheel, touch, windowFocusChange,
    gamepadConnect, gamepadDisconnect, gamepadButton, gamepadStick,
    get queueLength() { return queue.length; },
  };
}
