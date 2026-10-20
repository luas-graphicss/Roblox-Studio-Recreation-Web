import {
  isFiniteNumber,
  isString,
  isBoolean,
  isPlainObject,
  isOneOf,
} from "../utils/validate.js";


export const PropTypes = Object.freeze({
  String: "String",
  Number: "Number",
  Boolean: "Boolean",
  Color: "Color",                                                     
  Vector3: "Vector3",           
  Enum: "Enum",                               
  Instance: "Instance",                                          

  UDim: "UDim",                                                               
  UDim2: "UDim2",                                        
  Vector2: "Vector2",            
  Rect: "Rect",                              
  ColorSequence: "ColorSequence",                                    
  NumberSequence: "NumberSequence",                                              
  NumberRange: "NumberRange",                                                      


  CFrame: "CFrame",
  Ray: "Ray",

  Table: "Table",
});


export const Enums = Object.freeze({




  KeyCode: Object.freeze([
    "Unknown",
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
    "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "KeypadZero", "KeypadOne", "KeypadTwo", "KeypadThree", "KeypadFour",
    "KeypadFive", "KeypadSix", "KeypadSeven", "KeypadEight", "KeypadNine",
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
    "Space", "Return", "Escape", "Tab", "Backspace", "Delete",
    "LeftShift", "RightShift", "LeftControl", "RightControl", "LeftAlt", "RightAlt",
    "Up", "Down", "Left", "Right",
    "Home", "End", "PageUp", "PageDown", "Insert",
    "Comma", "Period", "Semicolon", "Quote", "Slash", "BackSlash",
    "LeftBracket", "RightBracket", "Minus", "Equals", "Backquote",
    "KeypadPlus", "KeypadMinus", "KeypadMultiply", "KeypadDivide", "KeypadDecimal", "KeypadEnter",
    "CapsLock", "NumLock", "ScrollLock", "LeftSuper", "RightSuper",
    "ButtonA", "ButtonB", "ButtonX", "ButtonY",
    "ButtonL1", "ButtonR1", "ButtonL2", "ButtonR2", "ButtonL3", "ButtonR3",
    "ButtonStart", "ButtonSelect",
    "DPadUp", "DPadDown", "DPadLeft", "DPadRight",
    "Thumbstick1", "Thumbstick2",
  ]),
  UserInputType: Object.freeze([
    "MouseButton1", "MouseButton2", "MouseButton3", "MouseWheel", "MouseMovement",
    "Touch", "Keyboard", "Focus", "Accelerometer", "Gyro",
    "Gamepad1", "Gamepad2", "Gamepad3", "Gamepad4",
    "Gamepad5", "Gamepad6", "Gamepad7", "Gamepad8",
    "TextInput", "InputMethod", "None",
  ]),
  UserInputState: Object.freeze(["Begin", "Change", "End", "Cancel", "None"]),
  MouseBehavior: Object.freeze(["Default", "LockCenter", "LockCurrentPosition"]),

  PackagePermission: Object.freeze(["UpToDate", "Modified", "OutOfDate"]),
  HighlightDepthMode: Object.freeze(["AlwaysOnTop", "Occluded"]),
  DragDetectorDragStyle: Object.freeze([
    "TranslateLine", "TranslatePlane", "TranslatePlaneOrLine", "TranslateViewPlane",
    "RotateAxis", "RotateTrackball", "Scriptable", "BestForDevice",
  ]),
  DragDetectorResponseStyle: Object.freeze(["Physical", "Geometric", "Custom"]),
  DragDetectorPermissionPolicy: Object.freeze(["All", "Nobody", "Scriptable"]),
  UIDragDetectorDragStyle: Object.freeze(["TranslateLine", "TranslatePlane", "Rotate", "Scriptable"]),
  UIDragDetectorResponseStyle: Object.freeze(["Offset", "Scale", "Custom"]),
  UIDragDetectorDragRelativity: Object.freeze(["Relative", "Absolute"]),
  HandlesStyle: Object.freeze(["Resize", "Move"]),
  HandlesFaces: Object.freeze(["All", "Top", "Bottom", "Left", "Right", "Front", "Back"]),
  ArcHandlesAxes: Object.freeze(["All", "X", "Y", "Z"]),

  PathStatus: Object.freeze([
    "Success", "ClosestNoPath", "ClosestOutOfRange",
    "FailStartNotEmpty", "FailFinishNotEmpty", "NoPath",
  ]),
  PathWaypointAction: Object.freeze(["Walk", "Jump", "Custom"]),

  ProductPurchaseDecision: Object.freeze(["NotProcessedYet", "PurchaseGranted"]),
  InfoType: Object.freeze(["Asset", "Product", "GamePass", "Bundle"]),

  SortDirection: Object.freeze(["Ascending", "Descending"]),
  RenderPriority: Object.freeze(["First", "Input", "Camera", "Character", "Control", "Reflection", "Last"]),
  ZIndexBehavior: Object.freeze(["Global", "Sibling"]),
  GuiType: Object.freeze(["CustomGui", "CoreGui"]),
  OverrideMouseIconBehavior: Object.freeze(["None", "ForceShow", "ForceHide"]),
  FontWeight: Object.freeze(["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold", "ExtraBold", "Heavy"]),
  FontStyle: Object.freeze(["Normal", "Italic"]),
  TextTruncate: Object.freeze(["None", "AtEnd"]),
  AutomaticSize: Object.freeze(["None", "X", "Y", "XY"]),
  ScrollingDirection: Object.freeze(["X", "Y", "XY"]),

  StartCorner: Object.freeze(["TopLeft", "TopRight", "BottomLeft", "BottomRight"]),
  LineJoinMode: Object.freeze(["Round", "Bevel", "Miter"]),
  SurfaceGuiSizingMode: Object.freeze(["FixedSize", "PixelsPerStud"]),
  ElasticBehavior: Object.freeze(["Always", "WhenScrollable", "Never"]),
  VerticalScrollBarPosition: Object.freeze(["Left", "Right"]),
  StudioStyleGuideModifier: Object.freeze(["Default", "Selected", "Pressed", "Disabled", "Hover"]),
  StudioStyleGuideColor: Object.freeze([
    "MainBackground", "Titlebar", "Dropdown", "Tooltip", "Notification", "ScrollBar",
    "ScrollBarBackground", "TabBar", "Tab", "RibbonTab", "RibbonTabTopBar", "Button",
    "MainButton", "ButtonText", "ButtonBorder", "MainText", "SubText", "TitlebarText",
    "BrightText", "DimmedText", "LinkText", "WarningText", "ErrorText", "InfoText",
    "SensitiveText", "InputFieldBackground", "InputFieldBorder", "Item", "TableItem",
    "CategoryItem", "Border", "Shadow", "Light", "Dark", "Mid", "CurrentMarker",
    "HeaderSection", "CheckedFieldBackground", "CheckedFieldBorder", "CheckedFieldIndicator",
  ]),
  ContextActionResult: Object.freeze(["Sink", "Pass"]),
  ContextActionPriority: Object.freeze(["Low", "Medium", "Default", "High"]),

  EasingStyle: Object.freeze(["Linear", "Sine", "Back", "Quad", "Quart", "Quint", "Bounce", "Elastic", "Exponential", "Circular", "Cubic"]),
  EasingDirection: Object.freeze(["In", "Out", "InOut"]),
  PlaybackState: Object.freeze(["Begin", "Delayed", "Playing", "Paused", "Completed", "Cancelled"]),

  ActuatorType: Object.freeze(["None", "Motor", "Servo"]),

  ActuatorRelativeTo: Object.freeze(["World", "Attachment0", "Attachment1"]),
  RaycastFilterType: Object.freeze(["Include", "Exclude"]),

  ProximityPromptExclusivity: Object.freeze(["OnePerButton", "OneGlobally", "AlwaysShow"]),
  ProximityPromptStyle: Object.freeze(["Default", "Custom"]),

  ParticleEmitterShape: Object.freeze(["Box", "Sphere", "Cylinder", "Disc"]),
  ParticleEmitterShapeStyle: Object.freeze(["Volume", "Surface"]),
  ParticleOrientation: Object.freeze([
    "FacingCamera",
    "FacingCameraWorldUp",
    "VelocityParallel",
    "VelocityPerpendicular",
  ]),
  ParticleFlipbookLayout: Object.freeze(["None", "Grid2x2", "Grid4x4", "Grid8x8"]),
  TextureMode: Object.freeze(["Wrap", "Stretch", "Static"]),
  ExplosionType: Object.freeze(["NoCraters", "Craters"]),

  RollOffMode: Object.freeze(["Inverse", "InverseTapered", "Linear", "LinearSquare"]),
  ReverbType: Object.freeze([
    "Off", "NoReverb", "GenericReverb", "PaddedCell", "Room", "Bathroom",
    "LivingRoom", "StoneRoom", "Auditorium", "ConcertHall", "Cave", "Arena",
    "Hangar", "CarpettedHallway", "Hallway", "StoneCorridor", "Alley",
    "Forest", "City", "Mountains", "Quarry", "Plain", "ParkingLot",
    "SewerPipe", "UnderWater",
  ]),
  ListenerType: Object.freeze(["Camera", "CFrame"]),


  CameraMode: Object.freeze(["Classic", "LockFirstPerson"]),
  DevCameraOcclusionMode: Object.freeze(["Zoom", "Invisicam"]),

  RunContext: Object.freeze(["Legacy", "Server", "Client", "Plugin"]),

  DevComputerCameraMode: Object.freeze(["UserChoice", "Classic", "Follow", "Orbital", "CameraToggle"]),
  DevTouchCameraMode: Object.freeze(["UserChoice", "Classic", "Follow", "Orbital"]),
  DevComputerMovementMode: Object.freeze(["UserChoice", "KeyboardMouse", "ClickToMove"]),
  DevTouchMovementMode: Object.freeze(["UserChoice", "Thumbstick", "DPad", "Thumbpad", "ClickToMove", "DynamicThumbstick"]),

  ChatMode: Object.freeze(["Default", "TextLabel", "Menu"]),
  ChatVersion: Object.freeze(["LegacyChatService", "TextChatService"]),

  CoreGuiType: Object.freeze(["All", "Backpack", "Chat", "Health", "PlayerList", "EmotesMenu", "SelfView", "Captures"]),

  ScreenOrientation: Object.freeze(["LandscapeLeft", "LandscapeRight", "LandscapeSensor", "Portrait", "Sensor"]),


  HumanoidStateType: Object.freeze([
    "FallingDown", "Ragdoll", "GettingUp", "Jumping", "Swimming", "Freefall",
    "Flying", "Landed", "Running", "RunningNoPhysics", "StrafingNoPhysics",
    "Climbing", "Seated", "PlatformStanding", "Dead", "Physics", "None",
  ]),
  HumanoidHealthDisplayType: Object.freeze(["DisplayWhenDamaged", "AlwaysOn", "AlwaysOff"]),

  BrickColorName: Object.freeze([
    "Medium stone grey", "White", "Dark stone grey", "Black",
    "Bright red", "Bright orange", "Bright yellow", "Bright green",
    "Dark green", "Bright blue", "Steel blue", "Navy blue",
    "Bright violet", "Magenta", "Pink", "Brown", "Reddish brown",
  ]),

  AnimationPriority: Object.freeze([
    "Action4",
    "Action3",
    "Action2",
    "Action",
    "Movement",
    "Idle",
    "Core",
  ]),
  Material: Object.freeze([
    "Plastic",
    "SmoothPlastic",
    "Wood",
    "WoodPlanks",
    "Slate",
    "Concrete",
    "Brick",
    "Cobblestone",
    "Metal",
    "CorrodedMetal",
    "DiamondPlate",
    "Foil",
    "Grass",
    "Sand",
    "Fabric",
    "Granite",
    "Marble",
    "Pebble",
    "Ice",
    "Glass",
    "Neon",
    "Glacier",

    "Rock",
    "Sandstone",
    "Basalt",
    "CrackedLava",
    "Limestone",
    "Pavement",
    "Mud",
    "Ground",
    "Asphalt",
    "Snow",
    "Salt",
    "Cardboard",
    "Carpet",
    "Plaster",
    "Rubber",
    "Leather",


    "Air",
    "Water",
  ]),
  Shape: Object.freeze(["Block", "Ball", "Cylinder", "Wedge", "CornerWedge"]),
  CameraType: Object.freeze([
    "Fixed",
    "Attach",
    "Watch",
    "Track",
    "Follow",
    "Custom",
    "Scriptable",
    "Orbital",
  ]),

  FieldOfViewMode: Object.freeze(["Vertical", "Diagonal", "MaxAxis"]),

  SurfaceType: Object.freeze([
    "Smooth",
    "Glue",
    "Weld",
    "Studs",
    "Inlet",
    "Universal",
    "Hinge",
    "Motor",
    "SteppingMotor",
  ]),

  CollisionFidelity: Object.freeze([
    "Default",
    "Hull",
    "Box",
    "PreciseConvexDecomposition",
  ]),
  RenderFidelity: Object.freeze(["Automatic", "Precise", "Performance"]),


  HumanoidRigType: Object.freeze(["R6", "R15"]),

  WeatherType: Object.freeze(["Clear", "Cloudy", "Rain", "HeavyRain", "Snow", "Blizzard", "Fog", "Sandstorm"]),


  StreamOutBehavior: Object.freeze(["Default", "LowMemory"]),


  ModelStreamingMode: Object.freeze(["Default", "Atomic", "Persistent", "PersistentPerPlayer"]),
  IKControlType: Object.freeze(["Transform", "Position", "Rotation", "LookAt"]),            

  AccessoryType: Object.freeze([
    "Unknown",
    "Hat",
    "Hair",
    "Face",
    "Neck",
    "Shoulder",
    "Front",
    "Back",
    "Waist",
    "TShirt",
    "Shirt",
    "Pants",
    "Jacket",
    "Sweater",
    "Shorts",
    "LeftShoe",
    "RightShoe",
    "DressSkirt",
    "Eyebrow",
    "Eyelash",
  ]),

  AutomaticExtentsMode: Object.freeze(["Full", "Disabled"]),

  HumanoidCollisionType: Object.freeze(["OuterBox", "InnerBox"]),

  MeshType: Object.freeze([
    "Head",
    "Torso",
    "Wedge",
    "Prism",
    "Pyramid",
    "ParallelRamp",
    "CornerWedge",
    "Brick",
    "Sphere",
    "Cylinder",
    "FileMesh",
  ]),



  Font: Object.freeze([
    "Legacy",
    "Arial",
    "ArialBold",
    "SourceSans",
    "SourceSansBold",
    "SourceSansItalic",
    "SourceSansSemibold",
    "SourceSansLight",
    "SourceSansSmallcaps",
    "Roboto",
    "RobotoBold",
    "RobotoLight",
    "RobotoMono",
    "GothamBlack",
    "GothamBold",
    "GothamMedium",
    "GothamLight",
    "TitilliumWeb",
    "Oswald",
    "Nunito",
    "Merriweather",
    "Ubuntu",
  ]),
  FillDirection: Object.freeze(["Horizontal", "Vertical"]),
  HorizontalAlignment: Object.freeze(["Left", "Center", "Right"]),
  VerticalAlignment: Object.freeze(["Top", "Center", "Bottom"]),
  ScaleType: Object.freeze(["Stretch", "Slice", "Tile", "Fit", "Crop"]),
  SortOrder: Object.freeze(["LayoutOrder", "Name"]),
  TextXAlignment: Object.freeze(["Left", "Center", "Right"]),
  TextYAlignment: Object.freeze(["Top", "Center", "Bottom"]),
  AspectType: Object.freeze(["FitWithinMaxSize", "ScaleWithParentSize"]),
  DominantAxis: Object.freeze(["Width", "Height"]),
  ApplyStrokeMode: Object.freeze(["Border", "Contextual"]),

  NormalId: Object.freeze(["Front", "Back", "Top", "Bottom", "Left", "Right"]),


  AlphaMode: Object.freeze(["Overlay", "Transparency", "TintMask"]),


  NormalMapConvention: Object.freeze(["Auto", "OpenGL", "DirectX"]),
  MaterialPattern: Object.freeze(["Regular", "Organic"]),


  LightingTechnology: Object.freeze(["Compatibility", "Voxel", "ShadowMap", "Future"]),


  ToneMapper: Object.freeze(["Legacy", "AgX", "ACES", "PBRNeutral"]),


  ColorGradingPreset: Object.freeze(["None", "FilmicCool", "Golden", "Noir"]),



  BloomMode: Object.freeze(["Classic", "Energy"]),





  RenderStyle: Object.freeze(["Classic", "Realistic"]),


  LightPreset: Object.freeze(["None", "Candle", "Tungsten", "Halogen", "LED", "Fluorescent", "Sodium", "Daylight"]),


  TerrainMaterial: Object.freeze([
    "Grass", "Sand", "Rock", "Water", "Sandstone", "Slate", "Concrete",
    "Brick", "Cobblestone", "Basalt", "CrackedLava", "Limestone",
    "Pavement", "Glacier", "Snow", "Ground", "Mud",
    "WoodPlanks", "Asphalt", "Ice", "LeafyGrass", "Salt",
  ]),
  TerrainBrushShape: Object.freeze(["Sphere", "Box", "Cylinder"]),
  TerrainBrushPivot: Object.freeze(["Center", "Base"]),
  TerrainBiome: Object.freeze([
    "Plains", "Hills", "Mountains", "Canyons", "Dunes", "Lavascape", "Arctic", "Water",
  ]),
});

function clamp01(n) {
  return isFiniteNumber(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function num(n) {
  return isFiniteNumber(n) ? n : 0;
}


export function makeColor(r, g, b) {
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}

export function makeVector3(x, y, z) {
  return { x: num(x), y: num(y), z: num(z) };
}


const UDIM_SCALE_MIN = -10;
const UDIM_SCALE_MAX = 10;

function clampScale(n) {
  if (!isFiniteNumber(n)) return 0;
  return Math.min(UDIM_SCALE_MAX, Math.max(UDIM_SCALE_MIN, n));
}

function intOffset(n) {
  return isFiniteNumber(n) ? Math.round(n) : 0;
}

export function makeUDim(scale, offset) {
  return { scale: clampScale(scale), offset: intOffset(offset) };
}

export function makeUDim2(xScale, xOffset, yScale, yOffset) {
  return {
    xScale: clampScale(xScale),
    xOffset: intOffset(xOffset),
    yScale: clampScale(yScale),
    yOffset: intOffset(yOffset),
  };
}

export function makeVector2(x, y) {
  return { x: num(x), y: num(y) };
}






export function makeCFrame(x, y, z, qx, qy, qz, qw) {
  let rx = qx == null ? 0 : Number(qx);
  let ry = qy == null ? 0 : Number(qy);
  let rz = qz == null ? 0 : Number(qz);
  let rw = qw == null ? 1 : Number(qw);
  const len =
    Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz) && Number.isFinite(rw)
      ? Math.sqrt(rx * rx + ry * ry + rz * rz + rw * rw)
      : 0;
  if (len > 1e-12) {
    rx /= len;
    ry /= len;
    rz /= len;
    rw /= len;
  } else {
    rx = 0;
    ry = 0;
    rz = 0;
    rw = 1;
  }
  return { x: num(x), y: num(y), z: num(z), qx: rx, qy: ry, qz: rz, qw: rw };
}


export function makeRay(origin, direction) {
  const o = origin || {};
  const d = direction || {};
  return {
    origin: { x: num(o.x), y: num(o.y), z: num(o.z) },
    direction: { x: num(d.x), y: num(d.y), z: num(d.z) },
  };
}

export function makeRect(minX, minY, maxX, maxY) {
  return { minX: num(minX), minY: num(minY), maxX: num(maxX), maxY: num(maxY) };
}


export function makeNumberRange(min, max) {
  const a = num(min);
  const b = num(max);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}


const MAX_SEQUENCE_KEYPOINTS = 20;



export function makeColorSequence(keypoints) {
  const out = [];
  if (Array.isArray(keypoints)) {
    for (const kp of keypoints) {
      if (!isPlainObject(kp) || !isPlainObject(kp.color)) continue;
      out.push({ time: clamp01(kp.time), color: makeColor(kp.color.r, kp.color.g, kp.color.b) });
      if (out.length >= MAX_SEQUENCE_KEYPOINTS) break;                         
    }
  }
  if (out.length < 2) {
    return {
      keypoints: [
        { time: 0, color: makeColor(1, 1, 1) },
        { time: 1, color: makeColor(1, 1, 1) },
      ],
    };
  }
  out.sort((a, b) => a.time - b.time);

  out[0].time = 0;
  out[out.length - 1].time = 1;
  return { keypoints: out };
}


export function makeNumberSequence(keypoints) {
  const out = [];
  if (Array.isArray(keypoints)) {
    for (const kp of keypoints) {
      if (!isPlainObject(kp) || !isFiniteNumber(kp.value)) continue;

      const env = isFiniteNumber(kp.envelope) ? Math.max(0, kp.envelope) : 0;
      out.push({ time: clamp01(kp.time), value: kp.value, envelope: env });
      if (out.length >= MAX_SEQUENCE_KEYPOINTS) break;                         
    }
  }
  if (out.length < 2) {
    return {
      keypoints: [
        { time: 0, value: 0, envelope: 0 },
        { time: 1, value: 0, envelope: 0 },
      ],
    };
  }
  out.sort((a, b) => a.time - b.time);

  out[0].time = 0;
  out[out.length - 1].time = 1;
  return { keypoints: out };
}


export function sanitizeName(value, fallback = "Instance") {
  if (!isString(value)) return fallback;
  let s = value
    .replace(/<[^>]*>/g, "")                         
    .replace(/[<>]/g, "")                                     
    .replace(/[\u0000-\u001F\u007F]/g, "")                          
    .trim();
  if (s.length === 0) return fallback;
  if (s.length > 200) s = s.slice(0, 200);
  return s;
}


export function coerceValue(type, value, descriptor) {
  switch (type) {
    case PropTypes.String:
      return isString(value) ? { ok: true, value } : { ok: false };
    case PropTypes.Number:
      if (!isFiniteNumber(value)) return { ok: false };

      return descriptor && descriptor.integer
        ? { ok: true, value: Math.round(value) }
        : { ok: true, value };
    case PropTypes.Boolean:


      if (descriptor && descriptor.allowNull === true && (value === null || value === undefined)) {
        return { ok: true, value: null };
      }
      return isBoolean(value) ? { ok: true, value } : { ok: false };
    case PropTypes.Color:
      if (
        isPlainObject(value) &&
        isFiniteNumber(value.r) &&
        isFiniteNumber(value.g) &&
        isFiniteNumber(value.b)
      ) {
        return { ok: true, value: makeColor(value.r, value.g, value.b) };
      }
      return { ok: false };
    case PropTypes.Vector3:
      if (
        isPlainObject(value) &&
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.z)
      ) {
        return { ok: true, value: makeVector3(value.x, value.y, value.z) };
      }
      return { ok: false };
    case PropTypes.Enum: {
      const options = descriptor && descriptor.options ? descriptor.options : [];
      return isOneOf(value, options) ? { ok: true, value } : { ok: false };
    }

    case PropTypes.UDim:
      if (isPlainObject(value) && isFiniteNumber(value.scale) && isFiniteNumber(value.offset)) {
        return { ok: true, value: makeUDim(value.scale, value.offset) };
      }
      return { ok: false };
    case PropTypes.UDim2:
      if (
        isPlainObject(value) &&
        isFiniteNumber(value.xScale) &&
        isFiniteNumber(value.xOffset) &&
        isFiniteNumber(value.yScale) &&
        isFiniteNumber(value.yOffset)
      ) {
        return { ok: true, value: makeUDim2(value.xScale, value.xOffset, value.yScale, value.yOffset) };
      }
      return { ok: false };
    case PropTypes.Vector2:
      if (isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)) {
        return { ok: true, value: makeVector2(value.x, value.y) };
      }
      return { ok: false };
    case PropTypes.Rect:
      if (
        isPlainObject(value) &&
        isFiniteNumber(value.minX) &&
        isFiniteNumber(value.minY) &&
        isFiniteNumber(value.maxX) &&
        isFiniteNumber(value.maxY)
      ) {
        return { ok: true, value: makeRect(value.minX, value.minY, value.maxX, value.maxY) };
      }
      return { ok: false };
    case PropTypes.NumberRange:
      if (isPlainObject(value) && isFiniteNumber(value.min) && isFiniteNumber(value.max)) {
        return { ok: true, value: makeNumberRange(value.min, value.max) };
      }
      return { ok: false };
    case PropTypes.ColorSequence:
      if (isPlainObject(value) && Array.isArray(value.keypoints)) {
        return { ok: true, value: makeColorSequence(value.keypoints) };
      }
      return { ok: false };
    case PropTypes.NumberSequence:
      if (isPlainObject(value) && Array.isArray(value.keypoints)) {
        return { ok: true, value: makeNumberSequence(value.keypoints) };
      }
      return { ok: false };
    case PropTypes.CFrame:
      if (
        isPlainObject(value) &&
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        isFiniteNumber(value.z)
      ) {
        return { ok: true, value: makeCFrame(value.x, value.y, value.z, value.qx, value.qy, value.qz, value.qw) };
      }
      return { ok: false };
    case PropTypes.Ray:


      if (
        isPlainObject(value) &&
        isPlainObject(value.origin) &&
        isPlainObject(value.direction) &&
        isFiniteNumber(value.origin.x) &&
        isFiniteNumber(value.origin.y) &&
        isFiniteNumber(value.origin.z) &&
        isFiniteNumber(value.direction.x) &&
        isFiniteNumber(value.direction.y) &&
        isFiniteNumber(value.direction.z)
      ) {
        return { ok: true, value: makeRay(value.origin, value.direction) };
      }
      return { ok: false };
    case PropTypes.Table: {

      if (!isPlainObject(value)) return { ok: false };
      const out = {};
      for (const k of Object.keys(value)) {
        const v = value[k];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[String(k)] = v;
      }
      return { ok: true, value: out };
    }
    case PropTypes.Instance:

      if (value === null || value === undefined) return { ok: true, value: null };

      if (
        value &&
        value.__isInstance === true &&
        typeof value.isDestroyed === "function" &&
        !value.isDestroyed()
      ) {
        return { ok: true, value };
      }
      return { ok: false };
    default:
      return { ok: false };
  }
}


export function cloneValue(type, value) {
  switch (type) {
    case PropTypes.Color:
      return value ? makeColor(value.r, value.g, value.b) : value;
    case PropTypes.Vector3:
      return value ? makeVector3(value.x, value.y, value.z) : value;
    case PropTypes.UDim:
      return value ? makeUDim(value.scale, value.offset) : value;
    case PropTypes.UDim2:
      return value ? makeUDim2(value.xScale, value.xOffset, value.yScale, value.yOffset) : value;
    case PropTypes.Vector2:
      return value ? makeVector2(value.x, value.y) : value;
    case PropTypes.Rect:
      return value ? makeRect(value.minX, value.minY, value.maxX, value.maxY) : value;
    case PropTypes.ColorSequence:
      return value && Array.isArray(value.keypoints) ? makeColorSequence(value.keypoints) : value;
    case PropTypes.NumberSequence:
      return value && Array.isArray(value.keypoints) ? makeNumberSequence(value.keypoints) : value;
    case PropTypes.NumberRange:
      return value ? makeNumberRange(value.min, value.max) : value;
    case PropTypes.CFrame:
      return value ? makeCFrame(value.x, value.y, value.z, value.qx, value.qy, value.qz, value.qw) : value;
    case PropTypes.Ray:
      return value ? makeRay(value.origin, value.direction) : value;
    case PropTypes.Table:
      return value && typeof value === "object" ? { ...value } : value;
    default:
      return value;
  }
}


function colorOrNumberSeqEqual(a, b, isColor) {
  if (!a || !b || !Array.isArray(a.keypoints) || !Array.isArray(b.keypoints)) return false;
  if (a.keypoints.length !== b.keypoints.length) return false;
  for (let i = 0; i < a.keypoints.length; i++) {
    const ka = a.keypoints[i];
    const kb = b.keypoints[i];
    if (ka.time !== kb.time) return false;
    if (isColor) {
      if (!ka.color || !kb.color || ka.color.r !== kb.color.r || ka.color.g !== kb.color.g || ka.color.b !== kb.color.b) return false;
    } else if (ka.value !== kb.value || (ka.envelope || 0) !== (kb.envelope || 0)) {
      return false;
    }
  }
  return true;
}


export function valuesEqual(type, a, b) {
  if (a === b) return true;
  switch (type) {
    case PropTypes.Color:
      return !!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b;
    case PropTypes.Vector3:
      return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
    case PropTypes.UDim:
      return !!a && !!b && a.scale === b.scale && a.offset === b.offset;
    case PropTypes.UDim2:
      return !!a && !!b && a.xScale === b.xScale && a.xOffset === b.xOffset && a.yScale === b.yScale && a.yOffset === b.yOffset;
    case PropTypes.Vector2:
      return !!a && !!b && a.x === b.x && a.y === b.y;
    case PropTypes.Rect:
      return !!a && !!b && a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
    case PropTypes.ColorSequence:
      return colorOrNumberSeqEqual(a, b, true);
    case PropTypes.NumberSequence:
      return colorOrNumberSeqEqual(a, b, false);
    case PropTypes.NumberRange:
      return !!a && !!b && a.min === b.min && a.max === b.max;
    case PropTypes.CFrame:


      return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z &&
        (a.qx || 0) === (b.qx || 0) && (a.qy || 0) === (b.qy || 0) &&
        (a.qz || 0) === (b.qz || 0) && (a.qw == null ? 1 : a.qw) === (b.qw == null ? 1 : b.qw);
    case PropTypes.Ray:
      return (
        !!a && !!b && !!a.origin && !!b.origin && !!a.direction && !!b.direction &&
        a.origin.x === b.origin.x && a.origin.y === b.origin.y && a.origin.z === b.origin.z &&
        a.direction.x === b.direction.x && a.direction.y === b.direction.y && a.direction.z === b.direction.z
      );
    case PropTypes.Table: {


      const deepEq = function deepEq(x, y) {
        if (x === y) return true;
        if (Array.isArray(x) || Array.isArray(y)) {
          if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
          for (let i = 0; i < x.length; i++) if (!deepEq(x[i], y[i])) return false;
          return true;
        }
        if (x && y && typeof x === "object" && typeof y === "object") {
          const kx = Object.keys(x);
          if (kx.length !== Object.keys(y).length) return false;
          for (const k of kx) {
            if (!Object.prototype.hasOwnProperty.call(y, k) || !deepEq(x[k], y[k])) return false;
          }
          return true;
        }
        return false;
      };
      return deepEq(a || {}, b || {});
    }
    default:
      return Object.is(a, b);
  }
}
