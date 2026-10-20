const NS = "http://www.w3.org/2000/svg";


const FILLED = new Set(["play", "pause", "stop", "assistant", "effect", "starFill", "caretRight", "caretDown"]);

const FALLBACK = [["rect", { x: "5", y: "5", width: "6", height: "6", rx: "1" }]];

const ICONS = {
  localization: [
    ["circle", { cx: "8", cy: "8", r: "5.5" }],
    ["path", { d: "M2.5 8 H13.5" }],
    ["path", { d: "M8 2.5 C10.2 4.3 10.2 11.7 8 13.5 C5.8 11.7 5.8 4.3 8 2.5 Z" }],
  ],
  gift: [
    ["rect", { x: "2.5", y: "6.5", width: "11", height: "7", rx: "1" }],
    ["path", { d: "M2 4 H14 V6.5 H2 Z" }],
    ["path", { d: "M8 4 V13.5" }],
    ["path", { d: "M8 4 C7.5 2 5.5 1.2 4.5 2.2 C3.5 3.2 5.5 4 8 4 Z" }],
    ["path", { d: "M8 4 C8.5 2 10.5 1.2 11.5 2.2 C12.5 3.2 10.5 4 8 4 Z" }],
  ],

  packageLink: [
    ["path", { d: "M6.5 9.5 L9.5 6.5" }],
    ["path", { d: "M7.5 4.5 L9 3 A2.5 2.5 0 0 1 12.5 6.5 L11 8" }],
    ["path", { d: "M8.5 11.5 L7 13 A2.5 2.5 0 0 1 3.5 9.5 L5 8" }],
  ],
  packageWarn: [
    ["path", { d: "M8 2.5 L14 13 H2 Z" }],
    ["path", { d: "M8 6.5 V9.8" }],
    ["path", { d: "M8 11.4 V11.6" }],
  ],
  highlight: [
    ["rect", { x: "4.5", y: "4.5", width: "7", height: "7", rx: "1" }],
    ["rect", { x: "2", y: "2", width: "12", height: "12", rx: "2", "stroke-dasharray": "2 1.6" }],
  ],
  selectionBox: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1", "stroke-dasharray": "2.4 1.8" }],
    ["circle", { cx: "8", cy: "8", r: "1.4" }],
  ],
  selectionSphere: [
    ["circle", { cx: "8", cy: "8", r: "5.5", "stroke-dasharray": "2.4 1.8" }],
    ["ellipse", { cx: "8", cy: "8", rx: "5.5", ry: "2.2" }],
  ],
  dragDetector: [
    ["path", { d: "M8 2 V14" }],
    ["path", { d: "M2 8 H14" }],
    ["path", { d: "M8 2 L6 4 M8 2 L10 4 M8 14 L6 12 M8 14 L10 12" }],
    ["path", { d: "M2 8 L4 6 M2 8 L4 10 M14 8 L12 6 M14 8 L12 10" }],
  ],
  uiDragDetector: [
    ["rect", { x: "2.5", y: "4", width: "8", height: "6", rx: "1" }],
    ["path", { d: "M11 11 L14 14 M14 14 L12.6 13.8 M14 14 L13.8 12.6" }],
  ],
  handles: [
    ["rect", { x: "5.5", y: "5.5", width: "5", height: "5" }],
    ["circle", { cx: "8", cy: "2.5", r: "1.2" }],
    ["circle", { cx: "8", cy: "13.5", r: "1.2" }],
    ["circle", { cx: "2.5", cy: "8", r: "1.2" }],
    ["circle", { cx: "13.5", cy: "8", r: "1.2" }],
  ],
  arcHandles: [
    ["circle", { cx: "8", cy: "8", r: "5.5" }],
    ["circle", { cx: "8", cy: "2.5", r: "1.3" }],
    ["circle", { cx: "13.5", cy: "8", r: "1.3" }],
  ],


  check: [["path", { d: "M3 8.5 L6.5 12 L13 4.5" }]],
  minimize: [["path", { d: "M3 8 H13" }]],
  maximize: [["rect", { x: "3.5", y: "3.5", width: "9", height: "9", rx: "1" }]],
  close: [["path", { d: "M4 4 L12 12" }], ["path", { d: "M12 4 L4 12" }]],


  play: [["path", { d: "M5 3 L13 8 L5 13 Z" }]],
  pause: [["path", { d: "M5 3 H7 V13 H5 Z" }], ["path", { d: "M9 3 H11 V13 H9 Z" }]],
  stop: [["rect", { x: "4", y: "4", width: "8", height: "8", rx: "1" }]],


  collab: [
    ["circle", { cx: "6", cy: "6.5", r: "2.2" }],
    ["path", { d: "M2.3 13 a3.7 3.7 0 0 1 7.4 0" }],
    ["circle", { cx: "11.3", cy: "6", r: "1.7" }],
    ["path", { d: "M10.2 12.6 a3 3 0 0 1 3.5-2.5" }],
  ],
  share: [
    ["circle", { cx: "12", cy: "4", r: "1.7" }],
    ["circle", { cx: "12", cy: "12", r: "1.7" }],
    ["circle", { cx: "4", cy: "8", r: "1.7" }],
    ["path", { d: "M10.5 4.8 L5.5 7.2" }],
    ["path", { d: "M5.5 8.8 L10.5 11.2" }],
  ],
  assistant: [
    ["path", { d: "M8 2 L9.1 6.4 L13.5 7.5 L9.1 8.6 L8 13 L6.9 8.6 L2.5 7.5 L6.9 6.4 Z" }],
  ],
  bell: [
    ["path", { d: "M4.6 11 C4.6 11 5.5 10 5.5 6.7 A2.5 2.5 0 0 1 10.5 6.7 C10.5 10 11.4 11 11.4 11 Z" }],
    ["path", { d: "M6.7 12.6 a1.5 1.5 0 0 0 2.6 0" }],
  ],
  account: [
    ["circle", { cx: "8", cy: "6", r: "2.4" }],
    ["path", { d: "M3.5 13 a4.6 4.6 0 0 1 9 0" }],
  ],


  moon: [["path", { d: "M12.5 9.2 A5 5 0 1 1 6.8 3.5 A4 4 0 0 0 12.5 9.2 Z" }]],
  sun: [
    ["circle", { cx: "8", cy: "8", r: "2.6" }],
    ["path", { d: "M8 1.5 V3 M8 13 V14.5 M1.5 8 H3 M13 8 H14.5 M3.4 3.4 L4.5 4.5 M11.5 11.5 L12.6 12.6 M12.6 3.4 L11.5 4.5 M4.5 11.5 L3.4 12.6" }],
  ],


  logo: [
    ["rect", { x: "2.5", y: "2.5", width: "11", height: "11", rx: "2.5" }],
    ["rect", { x: "6", y: "6", width: "4", height: "4", rx: "0.6" }],
  ],


  cursor: [["path", { d: "M3 3 L12.5 6.8 L8.2 8.2 L6.8 12.5 Z" }]],
  move: [
    ["path", { d: "M8 2 V14" }],
    ["path", { d: "M2 8 H14" }],
    ["path", { d: "M8 2 L6.4 3.7 M8 2 L9.6 3.7" }],
    ["path", { d: "M8 14 L6.4 12.3 M8 14 L9.6 12.3" }],
    ["path", { d: "M2 8 L3.7 6.4 M2 8 L3.7 9.6" }],
    ["path", { d: "M14 8 L12.3 6.4 M14 8 L12.3 9.6" }],
  ],
  rotate: [
    ["path", { d: "M12.6 6 A5 5 0 1 0 13 9.6" }],
    ["path", { d: "M12.8 2.8 V6 H9.6" }],
  ],
  scale: [
    ["path", { d: "M4.5 11.5 L11 5" }],
    ["path", { d: "M6.5 4.5 H11.5 V9.5" }],
    ["rect", { x: "2.5", y: "10.5", width: "3", height: "3", rx: "0.5" }],
  ],
  part: [
    ["path", { d: "M8 2 L14 5 V11 L8 14 L2 11 V5 Z" }],
    ["path", { d: "M2 5 L8 8 L14 5" }],
    ["path", { d: "M8 8 V14" }],
  ],
  model: [
    ["rect", { x: "2.5", y: "2.5", width: "6", height: "6", rx: "1" }],
    ["rect", { x: "7.5", y: "7.5", width: "6", height: "6", rx: "1" }],
  ],
  effect: [
    ["path", { d: "M8 2 L9.1 6.4 L13.5 7.5 L9.1 8.6 L8 13 L6.9 8.6 L2.5 7.5 L6.9 6.4 Z" }],
  ],
  duplicate: [
    ["rect", { x: "5", y: "5", width: "8", height: "8", rx: "1" }],
    ["path", { d: "M3 11 V3 H11" }],
  ],
  trash: [
    ["path", { d: "M4 4.5 H12" }],
    ["path", { d: "M5.5 4.5 V12.5 H10.5 V4.5" }],
    ["path", { d: "M6.5 4.5 V3 H9.5 V4.5" }],
  ],
  lock: [
    ["rect", { x: "4", y: "7.5", width: "8", height: "6", rx: "1" }],
    ["path", { d: "M5.8 7.5 V5.8 A2.2 2.2 0 0 1 10.2 5.8 V7.5" }],
  ],
  material: [
    ["circle", { cx: "8", cy: "8", r: "5.2" }],
    ["path", { d: "M5 9.5 A4 4 0 0 1 11 6" }],
  ],

  accessory: [
    ["path", { d: "M4.5 10.5 C4.5 7.5 5.5 5 8 5 C10.5 5 11.5 7.5 11.5 10.5" }],
    ["path", { d: "M2.5 10.5 H13.5" }],
    ["path", { d: "M6 5.2 C6 3.9 6.8 3 8 3 C9.2 3 10 3.9 10 5.2" }],
  ],
  wraplayer: [
    ["path", { d: "M3 6 C5 4.2 11 4.2 13 6" }],
    ["path", { d: "M3 9 C5 7.2 11 7.2 13 9" }],
    ["path", { d: "M3 12 C5 10.2 11 10.2 13 12" }],
  ],
  wraptarget: [
    ["circle", { cx: "8", cy: "8", r: "4.5" }],
    ["path", { d: "M8 1.5 V4" }],
    ["path", { d: "M8 12 V14.5" }],
    ["path", { d: "M1.5 8 H4" }],
    ["path", { d: "M12 8 H14.5" }],
  ],
  ikcontrol: [
    ["circle", { cx: "4.2", cy: "11.8", r: "1.7" }],
    ["circle", { cx: "8", cy: "5.4", r: "1.7" }],
    ["circle", { cx: "12.6", cy: "9.8", r: "1.4" }],
    ["path", { d: "M5 10.4 L7.2 6.9 M9.3 6.4 L11.5 8.9" }],
  ],
  meshpart: [
    ["path", { d: "M8 2 L13.5 5 V11 L8 14 L2.5 11 V5 Z" }],
    ["path", { d: "M2.5 5 L8 8 L13.5 5 M8 8 V14", stroke: "#7fb2e5" }],
  ],
  specialmesh: [
    ["circle", { cx: "8", cy: "7", r: "4.5" }],
    ["path", { d: "M3.5 7 H12.5 M8 2.5 V11.5", stroke: "#7fb2e5" }],
    ["path", { d: "M5 12.8 H11" }],
  ],
  decal: [
    ["rect", { x: "2.5", y: "2.5", width: "11", height: "11", rx: "1" }],
    ["circle", { cx: "6", cy: "6.2", r: "1.2", stroke: "#e0b54f" }],
    ["path", { d: "M3.5 11.5 L7 8 L9.5 10.5 L11 9 L12.5 10.7", stroke: "#7fb2e5" }],
  ],
  surfaceappearance: [
    ["rect", { x: "2.5", y: "2.5", width: "11", height: "11", rx: "1" }],
    ["path", { d: "M2.5 8 H13.5 M8 2.5 V13.5" }],
    ["circle", { cx: "5.2", cy: "5.2", r: "1.1", stroke: "#7fb2e5" }],
    ["circle", { cx: "10.8", cy: "10.8", r: "1.1", stroke: "#e0b54f" }],
  ],
  materialvariant: [
    ["circle", { cx: "6.5", cy: "6.5", r: "4" }],
    ["circle", { cx: "10", cy: "10", r: "3.4", stroke: "#7fb2e5" }],
  ],
  paint: [
    ["path", { d: "M3.5 9 L9 3.5 L12.5 7 L7 12.5 Z" }],
    ["path", { d: "M11 11 q2 1 1 3" }],
  ],
  texture: [
    ["rect", { x: "2.5", y: "2.5", width: "11", height: "11", rx: "1" }],
    ["path", { d: "M2.5 6.5 H13.5 M2.5 10 H13.5 M6 2.5 V13.5 M10 2.5 V13.5" }],
  ],
  group: [
    ["rect", { x: "2.8", y: "2.8", width: "7", height: "7", rx: "1" }],
    ["rect", { x: "6.2", y: "6.2", width: "7", height: "7", rx: "1" }],
  ],
  ungroup: [
    ["rect", { x: "2.5", y: "2.5", width: "5.5", height: "5.5", rx: "1" }],
    ["rect", { x: "8", y: "8", width: "5.5", height: "5.5", rx: "1" }],
  ],
  layers: [
    ["path", { d: "M8 2 L14 6 L8 10 L2 6 Z" }],
    ["path", { d: "M2.5 9.5 L8 13.5 L13.5 9.5" }],
  ],
  align: [
    ["path", { d: "M3 3 V13" }],
    ["path", { d: "M6 5 H12" }],
    ["path", { d: "M6 8 H10" }],
    ["path", { d: "M6 11 H13" }],
  ],
  text: [
    ["path", { d: "M4 4 H12" }],
    ["path", { d: "M8 4 V13" }],
  ],
  find: [
    ["circle", { cx: "7", cy: "7", r: "3.8" }],
    ["path", { d: "M9.8 9.8 L13.5 13.5" }],
  ],
  bug: [
    ["rect", { x: "5", y: "5.5", width: "6", height: "7", rx: "3" }],
    ["path", { d: "M5 8 H2.5 M11 8 H13.5 M5 11 H2.5 M11 11 H13.5 M6 5.5 L4.8 4 M10 5.5 L11.2 4" }],
  ],
  run: [["path", { d: "M5 3 L13 8 L5 13 Z" }]],
  plugin: [
    ["path", { d: "M6 2.8 V5 M10 2.8 V5" }],
    ["rect", { x: "4", y: "5", width: "8", height: "6.5", rx: "1.5" }],
    ["path", { d: "M7 11.5 V13.5 H9 V11.5" }],
  ],


  cut: [
    ["circle", { cx: "4", cy: "11.5", r: "1.8" }],
    ["circle", { cx: "4", cy: "4.5", r: "1.8" }],
    ["path", { d: "M5.4 5.6 L13 11.5 M5.4 10.4 L13 4.5" }],
  ],
  copy: [
    ["rect", { x: "5.5", y: "5.5", width: "7.5", height: "7.5", rx: "1" }],
    ["path", { d: "M3 10.5 V3 H10.5" }],
  ],
  paste: [
    ["rect", { x: "3.5", y: "3", width: "9", height: "10", rx: "1" }],
    ["path", { d: "M6 3 V2 H10 V3" }],
    ["path", { d: "M6 7 H10 M6 9.5 H10" }],
  ],
  undo: [
    ["path", { d: "M3.5 8 H10 a3 3 0 0 1 0 6 H6" }],
    ["path", { d: "M3.5 8 L6 5.5 M3.5 8 L6 10.5" }],
  ],
  redo: [
    ["path", { d: "M12.5 8 H6 a3 3 0 0 0 0 6 H10" }],
    ["path", { d: "M12.5 8 L10 5.5 M12.5 8 L10 10.5" }],
  ],
  transform: [
    ["path", { d: "M8 2 V14 M2 8 H14" }],
    ["circle", { cx: "8", cy: "8", r: "2.2" }],
    ["path", { d: "M8 2 L6.6 3.5 M8 2 L9.4 3.5 M14 8 L12.5 6.6 M14 8 L12.5 9.4" }],
  ],
  object: [
    ["path", { d: "M8 2 L14 5 V11 L8 14 L2 11 V5 Z" }],
    ["path", { d: "M2 5 L8 8 L14 5 M8 8 V14" }],
  ],
  create: [
    ["circle", { cx: "8", cy: "8", r: "5.2" }],
    ["path", { d: "M8 5.2 V10.8 M5.2 8 H10.8" }],
  ],
  ui: [
    ["rect", { x: "2.5", y: "3", width: "11", height: "10", rx: "1.2" }],
    ["path", { d: "M2.5 6.2 H13.5 M5.5 6.2 V13" }],
  ],


  instance: [["circle", { cx: "8", cy: "8", r: "3" }]],
  datamodel: [
    ["circle", { cx: "8", cy: "8", r: "5.5" }],
    ["path", { d: "M2.5 8 H13.5 M8 2.5 V13.5 M4.2 4.2 Q8 8 4.2 11.8 M11.8 4.2 Q8 8 11.8 11.8" }],
  ],
  workspace: [
    ["rect", { x: "2.5", y: "3", width: "11", height: "10", rx: "1.2" }],
    ["path", { d: "M2.5 6 H13.5" }],
    ["circle", { cx: "4.6", cy: "4.5", r: "0.7" }],
    ["circle", { cx: "6.6", cy: "4.5", r: "0.7" }],
  ],
  camera: [
    ["rect", { x: "2.5", y: "5", width: "8", height: "6.5", rx: "1" }],
    ["path", { d: "M10.5 7 L13.5 5.5 V11 L10.5 9.5 Z" }],
  ],
  terrain: [["path", { d: "M1.8 12.5 L6 6 L9 10 L11 7 L14.2 12.5 Z" }]],

  t_add: [["path", { d: "M8 3 V13" }], ["path", { d: "M3 8 H13" }]],
  t_sub: [["path", { d: "M3 8 H13" }]],
  t_smooth: [["path", { d: "M2 10 C5 5, 11 5, 14 10" }]],
  t_grow: [["path", { d: "M8 13 V5" }], ["path", { d: "M5 8 L8 5 L11 8" }]],
  t_erode: [["path", { d: "M8 3 V11" }], ["path", { d: "M5 8 L8 11 L11 8" }]],
  t_flatten: [["path", { d: "M3 6 H13" }], ["path", { d: "M3 10 H13" }]],
  t_water: [["path", { d: "M8 2 C8 2, 12.5 7, 12.5 10 A4.5 4.5 0 0 1 3.5 10 C3.5 7, 8 2, 8 2 Z" }]],
  t_generate: [["path", { d: "M8 2 L9.2 6 L13 7.2 L9.2 8.4 L8 12.4 L6.8 8.4 L3 7.2 L6.8 6 Z" }]],
  t_brush: [["path", { d: "M11 3 L13 5 L7 11 L4.5 11.5 L5 9 Z" }]],
  folder: [["path", { d: "M2.5 4.5 H6.4 L7.7 6 H13.5 V12 H2.5 Z" }]],
  script: [
    ["rect", { x: "3.5", y: "2.5", width: "9", height: "11", rx: "1" }],
    ["path", { d: "M5.5 5.5 H10.5 M5.5 8 H10.5 M5.5 10.5 H9" }],
  ],
  localscript: [
    ["rect", { x: "3.5", y: "2.5", width: "9", height: "11", rx: "1" }],
    ["path", { d: "M5.5 5.5 H10.5 M5.5 8 H9" }],
    ["circle", { cx: "10.6", cy: "10.6", r: "1.6" }],
  ],
  modulescript: [
    ["rect", { x: "3.5", y: "2.5", width: "9", height: "11", rx: "1" }],
    ["path", { d: "M6.6 5.5 L5 8 L6.6 10.5 M9.4 5.5 L11 8 L9.4 10.5" }],
  ],
  lighting: [
    ["circle", { cx: "8", cy: "6.8", r: "3.2" }],
    ["path", { d: "M6.4 11.4 H9.6 M6.9 13 H9.1" }],
  ],
  replicatedstorage: [
    ["rect", { x: "2.5", y: "3.5", width: "11", height: "9", rx: "1" }],
    ["path", { d: "M2.5 7 H13.5 M6.4 9.9 H9.6" }],
  ],
  serverstorage: [
    ["ellipse", { cx: "8", cy: "4.6", rx: "4.6", ry: "1.8" }],
    ["path", { d: "M3.4 4.6 V11.4 a4.6 1.8 0 0 0 9.2 0 V4.6" }],
    ["path", { d: "M3.4 8 a4.6 1.8 0 0 0 9.2 0" }],
  ],
  serverscriptservice: [
    ["circle", { cx: "8", cy: "8", r: "2.2" }],
    ["path", { d: "M8 2.4 V4 M8 12 V13.6 M2.4 8 H4 M12 8 H13.6 M4.1 4.1 L5.2 5.2 M10.8 10.8 L11.9 11.9 M11.9 4.1 L10.8 5.2 M5.2 10.8 L4.1 11.9" }],
  ],
  startergui: [
    ["rect", { x: "2.5", y: "3", width: "11", height: "8", rx: "1" }],
    ["path", { d: "M6 13 H10 M8 11 V13" }],
  ],
  starterpack: [
    ["path", { d: "M5.2 5 V4.2 a2.8 2.8 0 0 1 5.6 0 V5" }],
    ["rect", { x: "3.5", y: "5", width: "9", height: "8", rx: "1.5" }],
    ["path", { d: "M6.5 8.2 H9.5" }],
  ],
  starterplayer: [
    ["circle", { cx: "8", cy: "5.4", r: "2.2" }],
    ["path", { d: "M4 13 a4 4 0 0 1 8 0" }],
  ],
  soundservice: [
    ["path", { d: "M3 6.5 H5.5 L9 4 V12 L5.5 9.5 H3 Z" }],
    ["path", { d: "M10.8 6.4 a2.6 2.6 0 0 1 0 3.2" }],
  ],
  teams: [
    ["circle", { cx: "6", cy: "6.4", r: "2" }],
    ["path", { d: "M2.6 12.6 a3.5 3.5 0 0 1 6.8 0" }],
    ["circle", { cx: "11", cy: "6", r: "1.6" }],
    ["path", { d: "M10 11.9 a3 3 0 0 1 3.4-2.3" }],
  ],

  tweenservice: [
    ["path", { d: "M3 12.5 C 6.5 12.5 9.5 3.5 13 3.5" }],
    ["circle", { cx: "3", cy: "12.5", r: "1.2" }],
    ["circle", { cx: "13", cy: "3.5", r: "1.2" }],
  ],


  userinputservice: [
    ["path", { d: "M5 2.5 L11.5 8 L8.6 8.6 L10.2 12.2 L8.6 12.9 L7 9.3 L5 11.2 Z" }],
  ],
  contextactionservice: [
    ["path", { d: "M3 4.5 H13 V11.5 H3 Z" }],
    ["path", { d: "M5.5 8 H10.5" }],
  ],


  avatar: [
    ["circle", { cx: "8", cy: "4.6", r: "2.3" }],
    ["path", { d: "M3.6 13.4 a4.4 4.4 0 0 1 8.8 0" }],
  ],
  rig: [
    ["circle", { cx: "8", cy: "3.4", r: "1.6" }],
    ["path", { d: "M8 5 V10 M8 6.4 L4.5 8 M8 6.4 L11.5 8 M8 10 L5.5 13.5 M8 10 L10.5 13.5" }],
  ],
  accessory: [
    ["path", { d: "M4 9 a4 4 0 0 1 8 0 Z" }],
    ["path", { d: "M2.6 9 H13.4" }],
  ],
  shirt: [
    ["path", { d: "M5.5 2.6 L3 4.5 L4.5 6.5 L5.5 5.8 V13.4 H10.5 V5.8 L11.5 6.5 L13 4.5 L10.5 2.6 a2.5 2.5 0 0 1-5 0 Z" }],
  ],
  ruler: [
    ["rect", { x: "2", y: "5", width: "12", height: "6", rx: "1" }],
    ["path", { d: "M5 5 V7.5 M8 5 V8 M11 5 V7.5" }],
  ],
  body: [
    ["circle", { cx: "8", cy: "3.6", r: "1.8" }],
    ["path", { d: "M5.5 6 H10.5 V10 H5.5 Z M6.2 10 V13.6 M9.8 10 V13.6" }],
  ],
  eye: [
    ["path", { d: "M2 8 Q8 3 14 8 Q8 13 2 8 Z" }],
    ["circle", { cx: "8", cy: "8", r: "1.8" }],
  ],
  collision: [
    ["rect", { x: "2.6", y: "2.6", width: "10.8", height: "10.8", rx: "1.2" }],
    ["rect", { x: "5.2", y: "5.2", width: "5.6", height: "5.6", rx: "0.8" }],
  ],


  uimode: [
    ["rect", { x: "2.5", y: "3", width: "11", height: "10", rx: "1.2" }],
    ["path", { d: "M5 6 L8.4 9.4 L6.8 9.7 L7.8 11.4 Z" }],
  ],
  screengui: [
    ["rect", { x: "2.2", y: "3", width: "11.6", height: "8", rx: "1" }],
    ["path", { d: "M6 13 H10 M8 11 V13" }],
  ],
  billboardgui: [
    ["rect", { x: "3.5", y: "2.5", width: "9", height: "6", rx: "1" }],
    ["path", { d: "M8 8.5 V12 M6 13.5 H10" }],
  ],
  surfacegui: [
    ["path", { d: "M3 5 L11 3 V11 L3 13 Z" }],
    ["path", { d: "M11 3 L13 4 V12 L11 11" }],
  ],
  frame: [["rect", { x: "3", y: "3.5", width: "10", height: "9", rx: "1" }]],
  scrollingframe: [
    ["rect", { x: "3", y: "3.5", width: "10", height: "9", rx: "1" }],
    ["path", { d: "M11 4.5 V11.5" }],
    ["rect", { x: "10.2", y: "5.5", width: "1.6", height: "3", rx: "0.6" }],
  ],
  viewportframe: [
    ["rect", { x: "2.5", y: "3.5", width: "11", height: "9", rx: "1" }],
    ["path", { d: "M8 5.5 L10.5 7 V9.5 L8 11 L5.5 9.5 V7 Z" }],
  ],
  textlabel: [
    ["rect", { x: "2.5", y: "4", width: "11", height: "8", rx: "1" }],
    ["path", { d: "M5.5 7 H10.5 M8 7 V10" }],
  ],
  imagelabel: [
    ["rect", { x: "2.5", y: "3.5", width: "11", height: "9", rx: "1" }],
    ["circle", { cx: "5.5", cy: "6", r: "1" }],
    ["path", { d: "M3.5 11.5 L6.5 8.5 L9 11 L11 9 L12.5 10.5" }],
  ],
  textbutton: [
    ["rect", { x: "2.5", y: "5", width: "11", height: "6", rx: "2" }],
    ["path", { d: "M6.5 6.8 H9.5 M8 6.8 V9.2" }],
  ],
  imagebutton: [
    ["rect", { x: "2.5", y: "5", width: "11", height: "6", rx: "2" }],
    ["circle", { cx: "5.5", cy: "7", r: "0.8" }],
    ["path", { d: "M4 10 L6 8 L8 9.5 L10 7.5 L12 9.5" }],
  ],
  textbox: [
    ["rect", { x: "2.5", y: "4.5", width: "11", height: "7", rx: "1" }],
    ["path", { d: "M5 6 V10 M4.2 6 H5.8 M4.2 10 H5.8" }],
  ],
  videoframe: [
    ["rect", { x: "2.5", y: "3.5", width: "11", height: "9", rx: "1" }],
    ["path", { d: "M6.5 6 L10 8 L6.5 10 Z" }],
  ],
  selectionbox: [["path", { d: "M8 2.5 L13.5 5 V11 L8 13.5 L2.5 11 V5 Z" }]],
  uilayout: [["path", { d: "M3 4 H13 M3 7 H13 M3 10 H10 M3 12.5 H11" }]],
  uigrid: [
    ["rect", { x: "3", y: "3", width: "4", height: "4", rx: "0.6" }],
    ["rect", { x: "9", y: "3", width: "4", height: "4", rx: "0.6" }],
    ["rect", { x: "3", y: "9", width: "4", height: "4", rx: "0.6" }],
    ["rect", { x: "9", y: "9", width: "4", height: "4", rx: "0.6" }],
  ],
  uiconstraint: [["path", { d: "M5 3 H3 V13 H5 M11 3 H13 V13 H11" }]],
  uicorner: [["path", { d: "M3 13 V7 A4 4 0 0 1 7 3 H13" }]],
  uistroke: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["rect", { x: "5.5", y: "5.5", width: "5", height: "5", rx: "0.8" }],
  ],
  uigradient: [
    ["rect", { x: "3", y: "3.5", width: "10", height: "9", rx: "1" }],
    ["path", { d: "M3 12.5 L13 3.5" }],
  ],
  uipadding: [
    ["rect", { x: "2.5", y: "2.5", width: "11", height: "11", rx: "1" }],
    ["rect", { x: "5", y: "5", width: "6", height: "6", rx: "0.8" }],
  ],
  progressbar: [
    ["rect", { x: "2", y: "6", width: "12", height: "4", rx: "2" }],
    ["rect", { x: "2", y: "6", width: "7", height: "4", rx: "2" }],
  ],


  filter: [["path", { d: "M2.5 3.5 H13.5 L9.5 8 V12.5 L6.5 11 V8 Z" }]],
  settings: [
    ["circle", { cx: "8", cy: "8", r: "2.2" }],
    ["path", { d: "M8 1.8 V3.4 M8 12.6 V14.2 M1.8 8 H3.4 M12.6 8 H14.2 M3.6 3.6 L4.7 4.7 M11.3 11.3 L12.4 12.4 M12.4 3.6 L11.3 4.7 M4.7 11.3 L3.6 12.4" }],
  ],
  command: [
    ["rect", { x: "2.5", y: "3", width: "11", height: "10", rx: "1.5" }],
    ["path", { d: "M4.8 6 L7 8 L4.8 10 M8.4 10 H11.2" }],
  ],


  particle: [
    ["circle", { cx: "5", cy: "11", r: "2" }],
    ["circle", { cx: "10.5", cy: "6", r: "1.6" }],
    ["circle", { cx: "12.5", cy: "11.5", r: "1" }],
    ["circle", { cx: "6.5", cy: "4", r: "1" }],
  ],
  beam: [
    ["circle", { cx: "3.5", cy: "12.5", r: "1.4" }],
    ["circle", { cx: "12.5", cy: "3.5", r: "1.4" }],
    ["path", { d: "M4.8 11.2 L11.2 4.8" }],
    ["path", { d: "M6 13 L13 6" }],
  ],
  trail: [
    ["path", { d: "M2 12 C5 12 5 4 8 4 C11 4 11 12 14 12" }],
    ["circle", { cx: "13.5", cy: "11.5", r: "1.3" }],
  ],
  fire: [
    ["path", { d: "M8 2 C9.5 4.5 12 6 12 9.5 C12 12 10.2 13.8 8 13.8 C5.8 13.8 4 12 4 9.5 C4 7.5 5 6.5 5.8 5.2 C6.3 6.2 7 6.8 7.6 7 C7.2 5.3 7.4 3.6 8 2 Z" }],
  ],
  smoke: [
    ["circle", { cx: "5.5", cy: "10", r: "2.4" }],
    ["circle", { cx: "8.5", cy: "7", r: "2.8" }],
    ["circle", { cx: "11.5", cy: "10", r: "2.2" }],
  ],
  sparkles: [
    ["path", { d: "M6 2.5 L7 5.5 L10 6.5 L7 7.5 L6 10.5 L5 7.5 L2 6.5 L5 5.5 Z" }],
    ["path", { d: "M11.5 9 L12.2 11 L14 11.7 L12.2 12.4 L11.5 14.2 L10.8 12.4 L9 11.7 L10.8 11 Z" }],
  ],
  explosion: [
    ["path", { d: "M8 2 L9.2 5.4 L12.5 3.5 L11 6.8 L14 8 L11 9.2 L12.5 12.5 L9.2 10.6 L8 14 L6.8 10.6 L3.5 12.5 L5 9.2 L2 8 L5 6.8 L3.5 3.5 L6.8 5.4 Z" }],
  ],

  sound: [
    ["path", { d: "M2.5 6 L5 6 L8 3.2 L8 12.8 L5 10 L2.5 10 Z" }],
    ["path", { d: "M9.8 5.2 C11.4 6.5 11.4 9.5 9.8 10.8 L9.8 9.4 C10.4 8.7 10.4 7.3 9.8 6.6 Z" }],
    ["path", { d: "M11.6 3.4 C14 5.4 14 10.6 11.6 12.6 L11.6 11.1 C13 9.6 13 6.4 11.6 4.9 Z" }],
  ],
  soundGroup: [
    ["path", { d: "M2 5 L4 5 L6.4 2.8 L6.4 10.2 L4 8 L2 8 Z" }],
    ["rect", { x: "9", y: "3", width: "1.6", height: "10", rx: "0.8" }],
    ["rect", { x: "11.8", y: "5.5", width: "1.6", height: "7.5", rx: "0.8" }],
    ["rect", { x: "6.2", y: "11.5", width: "1.6", height: "2.5", rx: "0.8" }],
  ],
  soundEffect: [
    ["rect", { x: "2", y: "2.4", width: "12", height: "1.4", rx: "0.7" }],
    ["circle", { cx: "10.5", cy: "3.1", r: "1.9" }],
    ["rect", { x: "2", y: "7.3", width: "12", height: "1.4", rx: "0.7" }],
    ["circle", { cx: "5", cy: "8", r: "1.9" }],
    ["rect", { x: "2", y: "12.2", width: "12", height: "1.4", rx: "0.7" }],
    ["circle", { cx: "8", cy: "12.9", r: "1.9" }],
  ],


  remoteevent: [
    ["circle", { cx: "8", cy: "8", r: "1.6", stroke: "#4f9fe0" }],
    ["path", { d: "M4.4 4.4 A5.1 5.1 0 0 0 4.4 11.6", stroke: "#4f9fe0" }],
    ["path", { d: "M11.6 4.4 A5.1 5.1 0 0 1 11.6 11.6", stroke: "#4f9fe0" }],
  ],

  remotefunction: [
    ["circle", { cx: "7", cy: "6.5", r: "1.4", stroke: "#4f9fe0" }],
    ["path", { d: "M3.8 3.4 A4.6 4.6 0 0 0 3.8 9.6", stroke: "#4f9fe0" }],
    ["path", { d: "M10.2 3.4 A4.6 4.6 0 0 1 10.2 9.6", stroke: "#4f9fe0" }],
    ["path", { d: "M13 8 V12 H6.5", stroke: "#4f9fe0" }],
    ["path", { d: "M8.5 10 L6.5 12 L8.5 14", stroke: "#4f9fe0" }],
  ],

  bindableevent: [
    ["circle", { cx: "8", cy: "8", r: "2", stroke: "#9b7bdb" }],
    ["path", { d: "M8 2.4 V4.8 M8 11.2 V13.6 M2.4 8 H4.8 M11.2 8 H13.6", stroke: "#9b7bdb" }],
  ],

  bindablefunction: [
    ["circle", { cx: "7", cy: "7", r: "1.8", stroke: "#9b7bdb" }],
    ["path", { d: "M7 2.2 V4 M7 10 V11.8 M2.2 7 H4 M10 7 H11.8", stroke: "#9b7bdb" }],
    ["path", { d: "M13 8.5 V12.5 H7", stroke: "#9b7bdb" }],
    ["path", { d: "M9 10.5 L7 12.5 L9 14.5", stroke: "#9b7bdb" }],
  ],


  tool: [
    ["path", { d: "M9.5 3 a2.2 2.2 0 0 1 3 3 L7 11.5 L4.5 12.5 L5.5 10 Z" }],
    ["path", { d: "M5.5 10 L11.5 4" }],
  ],
  clickdetector: [
    ["path", { d: "M6 6 L13 9 L9.5 9.8 L11 13 L9.5 13.7 L8 10.5 L6 12 Z" }],
  ],
  proximityprompt: [
    ["rect", { x: "3", y: "5", width: "10", height: "6", rx: "3" }],
    ["path", { d: "M6.6 7 H9.2 M6.6 9 H8" }],
  ],
  seat: [
    ["path", { d: "M4 4 V9 H11 M11 9 V4 M4 9 V12 M11 9 V12" }],
  ],
  vehicleseat: [
    ["path", { d: "M4 5 V9 H11 M11 9 V5 M4 9 V11 M11 9 V11" }],
    ["circle", { cx: "5", cy: "13", r: "1" }],
    ["circle", { cx: "10", cy: "13", r: "1" }],
  ],


  tag: [
    ["path", { d: "M3 3 H8 L13 8 L8 13 L3 8 Z" }],
    ["circle", { cx: "5.5", cy: "5.5", r: "0.9" }],
  ],
  tageditor: [
    ["path", { d: "M2.5 3 H7 L12.5 8.5 L8.5 12.5 L3 7 Z" }],
    ["circle", { cx: "5", cy: "5.5", r: "0.9" }],
    ["path", { d: "M11 11 L14 14" }],
  ],


  value: [["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }]],
  stringvalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M5.5 6 H10.5 M5.5 8 H10.5 M5.5 10 H8.5" }],
  ],
  boolvalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M5.5 8.2 L7.2 10 L10.5 6" }],
  ],
  intvalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M7.5 6 L8.6 6 V10.5 M6.8 10.5 H10" }],
  ],
  numbervalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M6.5 6 V10.5 M9.5 6 V10.5" }],
    ["circle", { cx: "8", cy: "11", r: "0.6" }],
  ],
  objectvalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M6 8.5 a1.8 1.8 0 0 1 1.8-1.8 H8.5 M10 7.5 a1.8 1.8 0 0 1-1.8 1.8 H7.5" }],
  ],
  color3value: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["circle", { cx: "8", cy: "8", r: "2.4" }],
  ],
  brickcolorvalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M8 5.5 L10.5 8 L8 10.5 L5.5 8 Z" }],
  ],
  vector3value: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M8 11 V6 M8 6 L6.4 7.4 M8 6 L9.6 7.4 M5.5 9.5 L10.5 9.5" }],
  ],
  cframevalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M8 11 V6 M5.5 8.5 L8 6 L10.5 8.5" }],
    ["path", { d: "M5.5 10.5 a2 2 0 0 0 5 0" }],
  ],
  rayvalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M5 11 L11 5 M11 5 H8.4 M11 5 V7.6" }],
  ],
  intconstrainedvalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M5.5 5.5 V10.5 M10.5 5.5 V10.5 M5.5 8 H10.5" }],
  ],
  doubleconstrainedvalue: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1.5" }],
    ["path", { d: "M5.5 5.5 V10.5 M10.5 5.5 V10.5" }],
    ["path", { d: "M6.5 8 H9.5", "stroke-dasharray": "1 1" }],
  ],


  pathservice: [
    ["circle", { cx: "8", cy: "8", r: "5.5" }],
    ["path", { d: "M8 4.5 L9.5 9.5 L8 8.6 L6.5 9.5 Z" }],
  ],

  pathmodifier: [
    ["rect", { x: "3", y: "3", width: "10", height: "10", rx: "1" }],
    ["path", { d: "M3.5 6 H12.5 M3.5 8.5 H12.5 M3.5 11 H12.5", "stroke-dasharray": "1.5 1.5" }],
  ],

  pathlink: [
    ["circle", { cx: "4", cy: "12", r: "1.8" }],
    ["circle", { cx: "12", cy: "4", r: "1.8" }],
    ["path", { d: "M5.3 10.7 L10.7 5.3", "stroke-dasharray": "1.6 1.4" }],
  ],


  keyboard: [
    ["rect", { x: "1.8", y: "4.5", width: "12.4", height: "7", rx: "1.2" }],
    ["path", { d: "M4 6.8 H4.2 M6.2 6.8 H6.4 M8.4 6.8 H8.6 M10.6 6.8 H10.8 M4 9.2 H4.2 M5.9 9.2 H10.1 M11.8 9.2 H12" }],
  ],
  display: [
    ["rect", { x: "2", y: "3", width: "12", height: "8.5", rx: "1" }],
    ["path", { d: "M6 13.5 H10 M8 11.5 V13.5" }],
  ],
  shield: [
    ["path", { d: "M8 1.8 L13 3.8 V7.8 C13 10.9 10.9 13.2 8 14.2 C5.1 13.2 3 10.9 3 7.8 V3.8 Z" }],
    ["path", { d: "M5.8 7.9 L7.4 9.5 L10.3 6.4" }],
  ],
  coin: [
    ["ellipse", { cx: "8", cy: "4.8", rx: "5", ry: "2.1" }],
    ["path", { d: "M3 4.8 V11.2 C3 12.4 5.2 13.3 8 13.3 C10.8 13.3 13 12.4 13 11.2 V4.8" }],
    ["path", { d: "M3 8 C3 9.2 5.2 10.1 8 10.1 C10.8 10.1 13 9.2 13 8" }],
  ],
  pin: [
    ["path", { d: "M8 14 C8 14 12.6 9.8 12.6 6.6 A4.6 4.6 0 0 0 3.4 6.6 C3.4 9.8 8 14 8 14 Z" }],
    ["circle", { cx: "8", cy: "6.6", r: "1.7" }],
  ],
  physics: [
    ["ellipse", { cx: "8", cy: "8", rx: "5.8", ry: "2.3" }],
    ["ellipse", { cx: "8", cy: "8", rx: "5.8", ry: "2.3", transform: "rotate(60 8 8)" }],
    ["ellipse", { cx: "8", cy: "8", rx: "5.8", ry: "2.3", transform: "rotate(120 8 8)" }],
    ["circle", { cx: "8", cy: "8", r: "1" }],
  ],
  kebab: [
    ["circle", { cx: "8", cy: "3.4", r: "1.15" }],
    ["circle", { cx: "8", cy: "8", r: "1.15" }],
    ["circle", { cx: "8", cy: "12.6", r: "1.15" }],
  ],
  info: [
    ["circle", { cx: "8", cy: "8", r: "5.5" }],
    ["path", { d: "M8 7.4 V10.8" }],
    ["path", { d: "M8 5.1 V5.3" }],
  ],
  star: [
    ["path", { d: "M8 1.9 L9.9 5.7 L14.1 6.3 L11 9.2 L11.8 13.4 L8 11.4 L4.2 13.4 L5 9.2 L1.9 6.3 L6.1 5.7 Z" }],
  ],
  starFill: [
    ["path", { d: "M8 1.9 L9.9 5.7 L14.1 6.3 L11 9.2 L11.8 13.4 L8 11.4 L4.2 13.4 L5 9.2 L1.9 6.3 L6.1 5.7 Z" }],
  ],
  pencil: [
    ["path", { d: "M10.8 2.8 L13.2 5.2 L6 12.4 L3 13 L3.6 10 Z" }],
    ["path", { d: "M9.4 4.2 L11.8 6.6" }],
  ],
  listView: [["path", { d: "M3 4.5 H13 M3 8 H13 M3 11.5 H13" }]],
  circle: [["circle", { cx: "8", cy: "8", r: "5" }]],
  circleHalf: [
    ["circle", { cx: "8", cy: "8", r: "5" }],
    ["path", { d: "M8 3 A5 5 0 0 1 8 13 Z" }],
  ],
  arrowLeft: [
    ["path", { d: "M13 8 H3" }],
    ["path", { d: "M3 8 L6.8 4.2 M3 8 L6.8 11.8" }],
  ],

  caretRight: [["path", { d: "M6 4.2 L10.8 8 L6 11.8 Z" }]],
  caretDown: [["path", { d: "M4.2 6 L8 10.8 L11.8 6 Z" }]],
};


ICONS.warning = ICONS.packageWarn;
ICONS.globe = ICONS.localization;
ICONS.gridView = ICONS.uigrid;
ICONS.minus = ICONS.minimize;
ICONS.refresh = ICONS.rotate;

export function createIcon(name, size = 16) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", FILLED.has(name) ? "rsw-icon rsw-icon--filled" : "rsw-icon");

  const shapes = ICONS[name] || FALLBACK;
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    svg.appendChild(node);
  }
  return svg;
}
