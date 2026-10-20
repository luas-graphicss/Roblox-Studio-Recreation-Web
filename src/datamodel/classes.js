import {
  PropTypes as C,
  Enums,
  makeColor,
  makeVector3,
  makeVector2,
  makeUDim,
  makeUDim2,
  makeRect,
  makeColorSequence,
  makeNumberSequence,
  makeNumberRange,
  makeCFrame,
  makeRay,
} from "./types.js";
import { MSM_DEFAULT_STRENGTH, MSM_VIEW_OPTIONS } from "../lighting/megalightsSm/msmViewportSettingsCore.js";
import { SSM_PUBLIC_API } from "../lighting/substrateSm/ssmPublicApiCore.js";


function p(name, type, def, extra = {}) {
  return {
    name,
    type,
    default: def,
    readOnly: !!extra.readOnly,
    options: extra.options || null,


    hiddenOptions: extra.hiddenOptions || null,

    integer: !!extra.integer,


    allowNull: !!extra.allowNull,
  };
}


const DEFS = {
  Instance: {
    abstract: true,
    extends: null,
    defaultName: "Instance",
    props: [
      p("Name", C.String, "Instance"),


      p("Archivable", C.Boolean, true),
    ],
  },
  ServiceProvider: {
    abstract: true,
    extends: "Instance",
    defaultName: "ServiceProvider",
    props: [],
  },
  DataModel: {
    extends: "ServiceProvider",
    defaultName: "game",


    props: [
      p("PlaceId", C.Number, 0, { readOnly: true }),
      p("GameId", C.Number, 0, { readOnly: true }),
      p("JobId", C.String, "", { readOnly: true }),
    ],
  },


  Folder: { extends: "Instance", defaultName: "Folder", props: [] },
  Model: {
    extends: "Instance",
    defaultName: "Model",
    props: [


      p("PrimaryPart", C.Instance, null),
      p("PivotOffset", C.Vector3, makeVector3(0, 0, 0)),


      p("ModelStreamingMode", C.Enum, "Default", { options: Enums.ModelStreamingMode }),
    ],
  },


  BasePart: {
    abstract: true,
    extends: "Instance",
    defaultName: "BasePart",
    props: [
      p("Size", C.Vector3, makeVector3(4, 1, 2)),
      p("Position", C.Vector3, makeVector3(0, 0, 0)),
      p("Rotation", C.Vector3, makeVector3(0, 0, 0)),
      p("Anchored", C.Boolean, false),
      p("CanCollide", C.Boolean, true),

      p("CanTouch", C.Boolean, true),
      p("CanQuery", C.Boolean, true),
      p("Massless", C.Boolean, false),
      p("EnableFluidForces", C.Boolean, false),
      p("CollisionGroup", C.String, "Default"),


      p("CustomPhysicalProperties", C.Boolean, false),
      p("CustomDensity", C.Number, 0.7),
      p("CustomFriction", C.Number, 0.3),
      p("CustomElasticity", C.Number, 0.5),
      p("CustomFrictionWeight", C.Number, 1),
      p("CustomElasticityWeight", C.Number, 1),
      p("AssemblyLinearVelocity", C.Vector3, makeVector3(0, 0, 0)),
      p("AssemblyAngularVelocity", C.Vector3, makeVector3(0, 0, 0)),
      p("Color", C.Color, makeColor(0.639, 0.635, 0.647)),
      p("Material", C.Enum, "Plastic", { options: Enums.Material, hiddenOptions: ["Air", "Water"] }),

      p("MaterialVariant", C.String, ""),

      p("SubstrateMaterial", C.String, ""),
      p("Transparency", C.Number, 0),


      p("Reflectance", C.Number, 0),


      p("LocalTransparencyModifier", C.Number, 0),
      p("CastShadow", C.Boolean, true),


      p("Mirror", C.Boolean, false),
      p("Shape", C.Enum, "Block", { options: Enums.Shape }),
      p("Locked", C.Boolean, false),

      p("PivotOffset", C.Vector3, makeVector3(0, 0, 0)),
      p("TopSurface", C.Enum, "Smooth", { options: Enums.SurfaceType }),
      p("BottomSurface", C.Enum, "Smooth", { options: Enums.SurfaceType }),
      p("FrontSurface", C.Enum, "Smooth", { options: Enums.SurfaceType }),
      p("BackSurface", C.Enum, "Smooth", { options: Enums.SurfaceType }),
      p("LeftSurface", C.Enum, "Smooth", { options: Enums.SurfaceType }),
      p("RightSurface", C.Enum, "Smooth", { options: Enums.SurfaceType }),
    ],
  },
  Part: { extends: "BasePart", defaultName: "Part", props: [] },


  SpawnLocation: {
    extends: "BasePart",
    defaultName: "SpawnLocation",
    props: [
      p("Enabled", C.Boolean, true),
      p("Neutral", C.Boolean, true),
      p("TeamColor", C.Enum, "Medium stone grey", { options: Enums.BrickColorName }),
      p("Duration", C.Number, 10),
      p("AllowTeamChangeOnTouch", C.Boolean, false),
    ],
  },

  TrussPart: { extends: "BasePart", defaultName: "Truss", props: [] },

  ForceField: { extends: "Instance", defaultName: "ForceField", props: [p("Visible", C.Boolean, true)] },


  Tool: {
    extends: "Model",
    defaultName: "Tool",
    props: [
      p("RequiresHandle", C.Boolean, true),
      p("CanBeDropped", C.Boolean, true),
      p("Enabled", C.Boolean, true),
      p("GripPos", C.Vector3, makeVector3(0, 0, 0)),
      p("GripForward", C.Vector3, makeVector3(0, 0, -1)),
      p("GripRight", C.Vector3, makeVector3(1, 0, 0)),
      p("GripUp", C.Vector3, makeVector3(0, 1, 0)),
      p("ToolTip", C.String, ""),
      p("TextureId", C.String, ""),
      p("ManualActivationOnly", C.Boolean, false),
    ],
  },


  ClickDetector: {
    extends: "Instance",
    defaultName: "ClickDetector",
    props: [
      p("MaxActivationDistance", C.Number, 32),
      p("CursorIcon", C.String, ""),
    ],
  },

  DragDetector: {
    extends: "Instance",
    defaultName: "DragDetector",
    props: [
      p("DragStyle", C.Enum, "TranslatePlaneOrLine", { options: Enums.DragDetectorDragStyle }),
      p("ResponseStyle", C.Enum, "Geometric", { options: Enums.DragDetectorResponseStyle }),
      p("Enabled", C.Boolean, true),
      p("MaxDragAngle", C.Number, 0),
      p("MaxDragTranslation", C.Number, 0),
      p("MaxForce", C.Number, 10000),
      p("MaxTorque", C.Number, 10000),
      p("ReferenceInstance", C.Instance, null),
      p("Axis", C.Vector3, makeVector3(0, 1, 0)),
      p("PermissionPolicy", C.Enum, "All", { options: Enums.DragDetectorPermissionPolicy }),
      p("RunLocally", C.Boolean, false),
      p("ApplyAtCenterOfMass", C.Boolean, false),
      p("CursorIcon", C.String, ""),
      p("ActivatedCursorIcon", C.String, ""),
    ],
  },

  UIDragDetector: {
    extends: "Instance",
    defaultName: "UIDragDetector",
    props: [
      p("DragStyle", C.Enum, "TranslatePlane", { options: Enums.UIDragDetectorDragStyle }),
      p("ResponseStyle", C.Enum, "Offset", { options: Enums.UIDragDetectorResponseStyle }),
      p("Enabled", C.Boolean, true),
      p("BoundaryMin", C.UDim2, makeUDim2(0, 0, 0, 0)),
      p("BoundaryMax", C.UDim2, makeUDim2(0, 0, 0, 0)),
      p("DragRelativity", C.Enum, "Relative", { options: Enums.UIDragDetectorDragRelativity }),
      p("MaxDragAngle", C.Number, 0),
      p("MinDragAngle", C.Number, 0),
      p("ReferenceUIInstance", C.Instance, null),
      p("CursorIcon", C.String, ""),
    ],
  },


  ProximityPrompt: {
    extends: "Instance",
    defaultName: "ProximityPrompt",
    props: [
      p("ActionText", C.String, "Interact"),
      p("ObjectText", C.String, ""),
      p("KeyboardKeyCode", C.Enum, "E", { options: Enums.KeyCode }),
      p("GamepadKeyCode", C.Enum, "ButtonX", { options: Enums.KeyCode }),
      p("MaxActivationDistance", C.Number, 10),
      p("HoldDuration", C.Number, 0),
      p("RequiresLineOfSight", C.Boolean, true),
      p("Enabled", C.Boolean, true),
      p("Exclusivity", C.Enum, "OnePerButton", { options: Enums.ProximityPromptExclusivity }),
      p("Style", C.Enum, "Default", { options: Enums.ProximityPromptStyle }),
      p("UIOffset", C.Vector2, makeVector2(0, 0)),
    ],
  },


  Seat: {
    extends: "BasePart",
    defaultName: "Seat",
    props: [
      p("Disabled", C.Boolean, false),
      p("Occupant", C.Instance, null, { readOnly: true }),
    ],
  },


  VehicleSeat: {
    extends: "Seat",
    defaultName: "VehicleSeat",
    props: [
      p("MaxSpeed", C.Number, 30),
      p("Torque", C.Number, 10),
      p("TurnSpeed", C.Number, 1),
      p("Throttle", C.Number, 0, { readOnly: true }),
      p("ThrottleFloat", C.Number, 0, { readOnly: true }),
      p("Steer", C.Number, 0, { readOnly: true }),
      p("SteerFloat", C.Number, 0, { readOnly: true }),
      p("HeadsUpDisplay", C.Boolean, true),
    ],
  },


  PartOperation: {
    abstract: true,
    extends: "BasePart",
    defaultName: "PartOperation",
    props: [
      p("UsePartColor", C.Boolean, false),
      p("SmoothingAngle", C.Number, 50),
      p("CollisionFidelity", C.Enum, "Default", { options: Enums.CollisionFidelity }),
      p("RenderFidelity", C.Enum, "Automatic", { options: Enums.RenderFidelity }),
    ],
  },
  UnionOperation: { extends: "PartOperation", defaultName: "Union", props: [] },
  NegateOperation: { extends: "PartOperation", defaultName: "Negate", props: [] },


  ScreenGui: {
    extends: "Instance",
    defaultName: "ScreenGui",
    props: [
      p("DisplayOrder", C.Number, 0),
      p("Enabled", C.Boolean, true),
      p("IgnoreGuiInset", C.Boolean, false),
      p("ResetOnSpawn", C.Boolean, true),

      p("ZIndexBehavior", C.Enum, "Sibling", { options: Enums.ZIndexBehavior }),
    ],
  },
  BillboardGui: {
    extends: "Instance",
    defaultName: "BillboardGui",
    props: [
      p("Size", C.UDim2, makeUDim2(0, 200, 0, 50)),
      p("StudsOffset", C.Vector3, makeVector3(0, 0, 0)),
      p("StudsOffsetWorldSpace", C.Vector3, makeVector3(0, 0, 0)),
      p("FixedWorldSize", C.Boolean, false),
      p("Adornee", C.Instance, null),
      p("Enabled", C.Boolean, true),
      p("MaxDistance", C.Number, 0),
      p("AlwaysOnTop", C.Boolean, false),
      p("LightInfluence", C.Number, 0),
      p("Brightness", C.Number, 1),
      p("ClipsDescendants", C.Boolean, false),
      p("Active", C.Boolean, false),
    ],
  },
  SurfaceGui: {
    extends: "Instance",
    defaultName: "SurfaceGui",
    props: [
      p("Face", C.Enum, "Front", { options: Enums.NormalId }),
      p("Enabled", C.Boolean, true),
      p("Adornee", C.Instance, null),
      p("CanvasSize", C.Vector2, makeVector2(800, 600)),
      p("PixelsPerStud", C.Number, 50),

      p("SizingMode", C.Enum, "FixedSize", { options: Enums.SurfaceGuiSizingMode }),
      p("AlwaysOnTop", C.Boolean, false),
      p("LightInfluence", C.Number, 0),
      p("Brightness", C.Number, 1),
      p("ClipsDescendants", C.Boolean, false),
    ],
  },


  Frame: {
    extends: "Instance",
    defaultName: "Frame",
    props: [
      p("Size", C.UDim2, makeUDim2(0, 100, 0, 100)),
      p("Position", C.UDim2, makeUDim2(0, 0, 0, 0)),
      p("AnchorPoint", C.Vector2, makeVector2(0, 0)),
      p("BackgroundColor3", C.Color, makeColor(0.639, 0.635, 0.647)),
      p("BackgroundTransparency", C.Number, 0),
      p("BorderSizePixel", C.Number, 1),
      p("Visible", C.Boolean, true),
      p("ZIndex", C.Number, 1),
      p("ClipsDescendants", C.Boolean, false),
    ],
  },
  TextLabel: {
    extends: "Frame",
    defaultName: "TextLabel",
    props: [
      p("Text", C.String, "Label"),
      p("TextColor3", C.Color, makeColor(0, 0, 0)),
      p("TextSize", C.Number, 14),
      p("Font", C.Enum, "SourceSans", { options: Enums.Font }),
      p("TextWrapped", C.Boolean, false),
      p("TextXAlignment", C.Enum, "Center", { options: Enums.TextXAlignment }),
      p("TextYAlignment", C.Enum, "Center", { options: Enums.TextYAlignment }),
      p("RichText", C.Boolean, false),

      p("TextScaled", C.Boolean, false),
      p("TextTransparency", C.Number, 0),
      p("TextStrokeTransparency", C.Number, 1),
      p("TextStrokeColor3", C.Color, makeColor(0, 0, 0)),
    ],
  },
  TextButton: {
    extends: "TextLabel",
    defaultName: "TextButton",
    props: [
      p("AutoButtonColor", C.Boolean, true),
      p("Modal", C.Boolean, false),
    ],
    overrides: { Text: "Button" },
  },
  TextBox: {
    extends: "TextLabel",
    defaultName: "TextBox",
    props: [
      p("PlaceholderText", C.String, ""),
      p("PlaceholderColor3", C.Color, makeColor(0.7, 0.7, 0.7)),
      p("ClearTextOnFocus", C.Boolean, true),
      p("MultiLine", C.Boolean, false),

      p("TextEditable", C.Boolean, true),
    ],
    overrides: { Text: "" },
  },
  ImageLabel: {
    extends: "Frame",
    defaultName: "ImageLabel",
    props: [
      p("Image", C.String, ""),
      p("ImageColor3", C.Color, makeColor(1, 1, 1)),
      p("ImageTransparency", C.Number, 0),
      p("ScaleType", C.Enum, "Stretch", { options: Enums.ScaleType }),
      p("SliceCenter", C.Rect, makeRect(0, 0, 0, 0)),
      p("TileSize", C.UDim2, makeUDim2(1, 0, 1, 0)),
    ],
  },
  ImageButton: {
    extends: "ImageLabel",
    defaultName: "ImageButton",
    props: [
      p("AutoButtonColor", C.Boolean, true),
      p("Modal", C.Boolean, false),

      p("HoverImage", C.String, ""),
      p("PressedImage", C.String, ""),
    ],
  },
  ScrollingFrame: {
    extends: "Frame",
    defaultName: "ScrollingFrame",
    props: [
      p("ScrollingEnabled", C.Boolean, true),
      p("CanvasSize", C.UDim2, makeUDim2(0, 0, 2, 0)),
      p("ScrollBarThickness", C.Number, 12),
      p("ScrollBarImageColor3", C.Color, makeColor(0.13, 0.13, 0.13)),

      p("CanvasPosition", C.Vector2, makeVector2(0, 0)),
      p("AutomaticCanvasSize", C.Enum, "None", { options: Enums.AutomaticSize }),
      p("ScrollingDirection", C.Enum, "XY", { options: Enums.ScrollingDirection }),
    ],
  },
  ViewportFrame: {
    extends: "Frame",
    defaultName: "ViewportFrame",
    props: [
      p("CurrentCamera", C.Instance, null),
      p("Ambient", C.Color, makeColor(0.78, 0.78, 0.78)),
      p("LightColor", C.Color, makeColor(0.78, 0.78, 0.78)),
      p("LightDirection", C.Vector3, makeVector3(-1, -1, -1)),
    ],
  },
  VideoFrame: {
    extends: "Frame",
    defaultName: "VideoFrame",
    props: [
      p("Video", C.String, ""),
      p("Looped", C.Boolean, false),
      p("Playing", C.Boolean, false),
      p("Volume", C.Number, 1),
    ],
  },


  UIListLayout: {
    extends: "Instance",
    defaultName: "UIListLayout",
    props: [
      p("FillDirection", C.Enum, "Vertical", { options: Enums.FillDirection }),
      p("HorizontalAlignment", C.Enum, "Left", { options: Enums.HorizontalAlignment }),
      p("VerticalAlignment", C.Enum, "Top", { options: Enums.VerticalAlignment }),
      p("Padding", C.UDim, makeUDim(0, 0)),
      p("SortOrder", C.Enum, "LayoutOrder", { options: Enums.SortOrder }),
      p("Wraps", C.Boolean, false),
    ],
  },
  UIGridLayout: {
    extends: "Instance",
    defaultName: "UIGridLayout",
    props: [
      p("CellSize", C.UDim2, makeUDim2(0, 100, 0, 100)),
      p("CellPadding", C.UDim2, makeUDim2(0, 5, 0, 5)),
      p("FillDirection", C.Enum, "Horizontal", { options: Enums.FillDirection }),
      p("HorizontalAlignment", C.Enum, "Left", { options: Enums.HorizontalAlignment }),
      p("VerticalAlignment", C.Enum, "Top", { options: Enums.VerticalAlignment }),
      p("SortOrder", C.Enum, "LayoutOrder", { options: Enums.SortOrder }),

      p("FillDirectionMaxCells", C.Number, 0),
      p("StartCorner", C.Enum, "TopLeft", { options: Enums.StartCorner }),
    ],
  },
  UITableLayout: {
    extends: "Instance",
    defaultName: "UITableLayout",
    props: [
      p("FillDirection", C.Enum, "Vertical", { options: Enums.FillDirection }),
      p("SortOrder", C.Enum, "LayoutOrder", { options: Enums.SortOrder }),
      p("Padding", C.UDim2, makeUDim2(0, 0, 0, 0)),
      p("FillEmptySpaceColumns", C.Boolean, false),
      p("FillEmptySpaceRows", C.Boolean, false),
    ],
  },
  UIPageLayout: {
    extends: "Instance",
    defaultName: "UIPageLayout",
    props: [
      p("FillDirection", C.Enum, "Horizontal", { options: Enums.FillDirection }),
      p("SortOrder", C.Enum, "LayoutOrder", { options: Enums.SortOrder }),
      p("Padding", C.UDim, makeUDim(0, 0)),
      p("Circular", C.Boolean, false),
    ],
  },


  UIAspectRatioConstraint: {
    extends: "Instance",
    defaultName: "UIAspectRatioConstraint",
    props: [
      p("AspectRatio", C.Number, 1),
      p("AspectType", C.Enum, "FitWithinMaxSize", { options: Enums.AspectType }),
      p("DominantAxis", C.Enum, "Width", { options: Enums.DominantAxis }),
    ],
  },
  UISizeConstraint: {
    extends: "Instance",
    defaultName: "UISizeConstraint",
    props: [
      p("MinSize", C.Vector2, makeVector2(0, 0)),
      p("MaxSize", C.Vector2, makeVector2(100000, 100000)),
    ],
  },
  UITextSizeConstraint: {
    extends: "Instance",
    defaultName: "UITextSizeConstraint",
    props: [
      p("MinTextSize", C.Number, 1),
      p("MaxTextSize", C.Number, 100),
    ],
  },


  UICorner: {
    extends: "Instance",
    defaultName: "UICorner",
    props: [p("CornerRadius", C.UDim, makeUDim(0, 8))],
  },
  UIStroke: {
    extends: "Instance",
    defaultName: "UIStroke",
    props: [
      p("Color", C.Color, makeColor(0, 0, 0)),
      p("Thickness", C.Number, 1),
      p("Transparency", C.Number, 0),
      p("ApplyStrokeMode", C.Enum, "Contextual", { options: Enums.ApplyStrokeMode }),

      p("LineJoinMode", C.Enum, "Round", { options: Enums.LineJoinMode }),
    ],
  },
  UIGradient: {
    extends: "Instance",
    defaultName: "UIGradient",
    props: [
      p("Color", C.ColorSequence, makeColorSequence([
        { time: 0, color: makeColor(1, 1, 1) },
        { time: 1, color: makeColor(1, 1, 1) },
      ])),
      p("Transparency", C.NumberSequence, makeNumberSequence([
        { time: 0, value: 0 },
        { time: 1, value: 0 },
      ])),
      p("Offset", C.Vector2, makeVector2(0, 0)),
      p("Rotation", C.Number, 0),
      p("Enabled", C.Boolean, true),
    ],
  },
  UIPadding: {
    extends: "Instance",
    defaultName: "UIPadding",
    props: [
      p("PaddingTop", C.UDim, makeUDim(0, 0)),
      p("PaddingBottom", C.UDim, makeUDim(0, 0)),
      p("PaddingLeft", C.UDim, makeUDim(0, 0)),
      p("PaddingRight", C.UDim, makeUDim(0, 0)),
    ],
  },


  SelectionBox: {
    extends: "Instance",
    defaultName: "SelectionBox",
    props: [
      p("Color3", C.Color, makeColor(0.06, 0.69, 1)),
      p("SurfaceColor3", C.Color, makeColor(0.06, 0.69, 1)),
      p("LineThickness", C.Number, 0.15),
      p("SurfaceTransparency", C.Number, 1),
      p("Transparency", C.Number, 0),
      p("Adornee", C.Instance, null),
      p("Visible", C.Boolean, true),
    ],
  },

  SelectionSphere: {
    extends: "Instance",
    defaultName: "SelectionSphere",
    props: [
      p("Color3", C.Color, makeColor(0.06, 0.69, 1)),
      p("SurfaceColor3", C.Color, makeColor(0.06, 0.69, 1)),
      p("LineThickness", C.Number, 0.15),
      p("SurfaceTransparency", C.Number, 1),
      p("Transparency", C.Number, 0),
      p("Adornee", C.Instance, null),
      p("Visible", C.Boolean, true),
    ],
  },

  Highlight: {
    extends: "Instance",
    defaultName: "Highlight",
    props: [
      p("Adornee", C.Instance, null),
      p("FillColor", C.Color, makeColor(1, 1, 1)),
      p("FillTransparency", C.Number, 0.5),
      p("OutlineColor", C.Color, makeColor(1, 1, 1)),
      p("OutlineTransparency", C.Number, 0),
      p("DepthMode", C.Enum, "AlwaysOnTop", { options: Enums.HighlightDepthMode }),
      p("Enabled", C.Boolean, true),
    ],
  },

  Handles: {
    extends: "Instance",
    defaultName: "Handles",
    props: [
      p("Adornee", C.Instance, null),
      p("Color3", C.Color, makeColor(0.06, 0.69, 1)),
      p("Style", C.Enum, "Resize", { options: Enums.HandlesStyle }),
      p("Faces", C.Enum, "All", { options: Enums.HandlesFaces }),
      p("Visible", C.Boolean, true),
    ],
  },

  ArcHandles: {
    extends: "Instance",
    defaultName: "ArcHandles",
    props: [
      p("Adornee", C.Instance, null),
      p("Color3", C.Color, makeColor(0.06, 0.69, 1)),
      p("Axes", C.Enum, "All", { options: Enums.ArcHandlesAxes }),
      p("Visible", C.Boolean, true),
    ],
  },

  PackageLink: {
    extends: "Instance",
    defaultName: "PackageLink",
    props: [
      p("PackageId", C.String, ""),
      p("VersionNumber", C.Number, 1, { readOnly: true }),
      p("AutoUpdate", C.Boolean, false),
      p("Status", C.Enum, "UpToDate", { options: Enums.PackagePermission, readOnly: true }),
    ],
  },


  Weld: { extends: "Instance", defaultName: "Weld", props: [p("Enabled", C.Boolean, true), p("Part0", C.Instance, null), p("Part1", C.Instance, null), p("C0", C.Vector3, makeVector3(0, 0, 0)), p("C1", C.Vector3, makeVector3(0, 0, 0))] },
  WeldConstraint: { extends: "Instance", defaultName: "WeldConstraint", props: [p("Enabled", C.Boolean, true), p("Part0", C.Instance, null), p("Part1", C.Instance, null)] },
  Motor6D: { extends: "Instance", defaultName: "Motor6D", props: [p("Enabled", C.Boolean, true), p("Part0", C.Instance, null), p("Part1", C.Instance, null)] },


  HingeConstraint: {
    extends: "Instance",
    defaultName: "HingeConstraint",
    props: [
      p("Enabled", C.Boolean, true),
      p("Attachment0", C.Instance, null),
      p("Attachment1", C.Instance, null),
      p("ActuatorType", C.Enum, "None", { options: Enums.ActuatorType }),
      p("TargetAngle", C.Number, 0),
      p("AngularVelocity", C.Number, 0),
      p("MotorMaxTorque", C.Number, 1000),
      p("ServoMaxTorque", C.Number, 1000),
      p("LimitsEnabled", C.Boolean, false),
      p("LowerAngle", C.Number, -45),
      p("UpperAngle", C.Number, 45),
    ],
  },
  RopeConstraint: {
    extends: "Instance",
    defaultName: "RopeConstraint",
    props: [
      p("Enabled", C.Boolean, true),
      p("Attachment0", C.Instance, null),
      p("Attachment1", C.Instance, null),
      p("Length", C.Number, 4),

      p("Restitution", C.Number, 0),
      p("Visible", C.Boolean, false),
      p("Thickness", C.Number, 0.1),
      p("Color", C.Color, makeColor(0.6, 0.4, 0.2)),
    ],
  },
  SpringConstraint: {
    extends: "Instance",
    defaultName: "SpringConstraint",
    props: [
      p("Enabled", C.Boolean, true),
      p("Attachment0", C.Instance, null),
      p("Attachment1", C.Instance, null),
      p("FreeLength", C.Number, 4),
      p("Stiffness", C.Number, 100),
      p("Damping", C.Number, 10),

      p("Coils", C.Number, 3),
      p("MinLength", C.Number, 0),
      p("MaxLength", C.Number, 20),
    ],
  },
  BallSocketConstraint: {
    extends: "Instance",
    defaultName: "BallSocketConstraint",
    props: [
      p("Enabled", C.Boolean, true),
      p("Attachment0", C.Instance, null),
      p("Attachment1", C.Instance, null),
      p("LimitsEnabled", C.Boolean, false),
      p("UpperAngle", C.Number, 45),
      p("TwistLimitsEnabled", C.Boolean, false),
      p("TwistLowerAngle", C.Number, -45),
      p("TwistUpperAngle", C.Number, 45),
    ],
  },
  PrismaticConstraint: {
    extends: "Instance",
    defaultName: "PrismaticConstraint",
    props: [
      p("Enabled", C.Boolean, true),
      p("Attachment0", C.Instance, null),
      p("Attachment1", C.Instance, null),
      p("ActuatorType", C.Enum, "None", { options: Enums.ActuatorType }),
      p("TargetPosition", C.Number, 0),
      p("Velocity", C.Number, 0),
      p("MotorMaxForce", C.Number, 1000),
      p("ServoMaxForce", C.Number, 1000),
      p("LimitsEnabled", C.Boolean, false),
      p("LowerLimit", C.Number, -5),
      p("UpperLimit", C.Number, 5),
    ],
  },


  Attachment: { extends: "Instance", defaultName: "Attachment", props: [p("Position", C.Vector3, makeVector3(0, 0, 0)), p("Orientation", C.Vector3, makeVector3(0, 0, 0))] },


  Bone: {
    extends: "Attachment",
    defaultName: "Bone",
    props: [
      p("Transform", C.CFrame, makeCFrame(0, 0, 0)),
      p("TransformRotation", C.Vector3, makeVector3(0, 0, 0)),
    ],
  },


  PathfindingService: { extends: "Instance", defaultName: "PathfindingService", props: [], service: true },


  PathfindingModifier: {
    extends: "Instance",
    defaultName: "PathfindingModifier",
    props: [
      p("PassThrough", C.Boolean, true),
      p("Label", C.String, ""),

      p("Costs", C.Table, {}),
    ],
  },

  PathfindingLink: {
    extends: "Instance",
    defaultName: "PathfindingLink",
    props: [
      p("Attachment0", C.Instance, null),
      p("Attachment1", C.Instance, null),
      p("Label", C.String, ""),
      p("IsBidirectional", C.Boolean, true),
    ],
  },


  ParticleEmitter: {
    extends: "Instance",
    defaultName: "ParticleEmitter",
    props: [
      p("Enabled", C.Boolean, true),
      p("Rate", C.Number, 20),
      p("Lifetime", C.NumberRange, makeNumberRange(5, 10)),
      p("Speed", C.NumberRange, makeNumberRange(5, 5)),
      p("SpreadAngle", C.Vector2, makeVector2(0, 0)),
      p("Acceleration", C.Vector3, makeVector3(0, 0, 0)),
      p("Drag", C.Number, 0),
      p("VelocityInheritance", C.Number, 0),
      p("RotSpeed", C.NumberRange, makeNumberRange(0, 0)),
      p("Rotation", C.NumberRange, makeNumberRange(0, 0)),
      p("EmissionDirection", C.Enum, "Top", { options: Enums.NormalId }),
      p("Shape", C.Enum, "Box", { options: Enums.ParticleEmitterShape }),
      p("ShapeStyle", C.Enum, "Volume", { options: Enums.ParticleEmitterShapeStyle }),
      p("Texture", C.String, ""),
      p("Size", C.NumberSequence, makeNumberSequence([{ time: 0, value: 1 }, { time: 1, value: 1 }])),
      p("Transparency", C.NumberSequence, makeNumberSequence([{ time: 0, value: 0 }, { time: 1, value: 0 }])),
      p("Color", C.ColorSequence, makeColorSequence([{ time: 0, color: makeColor(1, 1, 1) }, { time: 1, color: makeColor(1, 1, 1) }])),
      p("LightEmission", C.Number, 0),
      p("LightInfluence", C.Number, 1),
      p("ZOffset", C.Number, 0),
      p("LockedToPart", C.Boolean, false),
      p("Squash", C.NumberSequence, makeNumberSequence([{ time: 0, value: 0 }, { time: 1, value: 0 }])),
      p("Orientation", C.Enum, "FacingCamera", { options: Enums.ParticleOrientation }),
      p("WindAffectsDrag", C.Boolean, false),
      p("FlipbookFramesPerSecond", C.Number, 8),
      p("FlipbookLayout", C.Enum, "None", { options: Enums.ParticleFlipbookLayout }),
    ],
  },

  Beam: {
    extends: "Instance",
    defaultName: "Beam",
    props: [
      p("Attachment0", C.Instance, null),
      p("Attachment1", C.Instance, null),
      p("Enabled", C.Boolean, true),
      p("Color", C.ColorSequence, makeColorSequence([{ time: 0, color: makeColor(1, 1, 1) }, { time: 1, color: makeColor(1, 1, 1) }])),
      p("Transparency", C.NumberSequence, makeNumberSequence([{ time: 0, value: 0 }, { time: 1, value: 0 }])),
      p("Width0", C.Number, 1),
      p("Width1", C.Number, 1),
      p("Texture", C.String, ""),
      p("TextureLength", C.Number, 1),
      p("TextureMode", C.Enum, "Stretch", { options: Enums.TextureMode }),
      p("TextureSpeed", C.Number, 0),
      p("LightEmission", C.Number, 0),
      p("LightInfluence", C.Number, 0),
      p("FaceCamera", C.Boolean, false),
      p("Segments", C.Number, 10),
      p("CurveSize0", C.Number, 0),
      p("CurveSize1", C.Number, 0),
      p("ZOffset", C.Number, 0),
    ],
  },

  Trail: {
    extends: "Instance",
    defaultName: "Trail",
    props: [
      p("Attachment0", C.Instance, null),
      p("Attachment1", C.Instance, null),
      p("Enabled", C.Boolean, true),
      p("Color", C.ColorSequence, makeColorSequence([{ time: 0, color: makeColor(1, 1, 1) }, { time: 1, color: makeColor(1, 1, 1) }])),
      p("Transparency", C.NumberSequence, makeNumberSequence([{ time: 0, value: 0.5 }, { time: 1, value: 1 }])),
      p("Lifetime", C.Number, 2),
      p("MinLength", C.Number, 0.1),
      p("MaxLength", C.Number, 10),
      p("Texture", C.String, ""),
      p("TextureLength", C.Number, 1),
      p("TextureMode", C.Enum, "Stretch", { options: Enums.TextureMode }),
      p("LightEmission", C.Number, 0),
      p("LightInfluence", C.Number, 0),
      p("FaceCamera", C.Boolean, false),
      p("WidthScale", C.NumberSequence, makeNumberSequence([{ time: 0, value: 1 }, { time: 1, value: 1 }])),
    ],
  },

  Fire: {
    extends: "Instance",
    defaultName: "Fire",
    props: [
      p("Enabled", C.Boolean, true),
      p("Color", C.Color, makeColor(0.93, 0.55, 0.2)),
      p("SecondaryColor", C.Color, makeColor(0.86, 0.26, 0.05)),
      p("Size", C.Number, 5),
      p("Heat", C.Number, 9),
      p("TimeScale", C.Number, 1),
    ],
  },
  Smoke: {
    extends: "Instance",
    defaultName: "Smoke",
    props: [
      p("Enabled", C.Boolean, true),
      p("Color", C.Color, makeColor(0.7, 0.7, 0.72)),
      p("Opacity", C.Number, 0.5),
      p("Size", C.Number, 1),
      p("RiseVelocity", C.Number, 1),
      p("TimeScale", C.Number, 1),
    ],
  },
  Sparkles: {
    extends: "Instance",
    defaultName: "Sparkles",
    props: [
      p("Enabled", C.Boolean, true),
      p("SparkleColor", C.Color, makeColor(0.98, 0.85, 0.25)),
      p("TimeScale", C.Number, 1),
    ],
  },

  Explosion: {
    extends: "Instance",
    defaultName: "Explosion",
    props: [
      p("Position", C.Vector3, makeVector3(0, 0, 0)),
      p("BlastRadius", C.Number, 4),
      p("BlastPressure", C.Number, 500000),
      p("DestroyJointRadiusPercent", C.Number, 1),
      p("ExplosionType", C.Enum, "NoCraters", { options: Enums.ExplosionType }),
      p("Visible", C.Boolean, true),
      p("TimeScale", C.Number, 1),
    ],
  },




  BodyVelocity: { extends: "Instance", defaultName: "BodyVelocity", props: [p("Velocity", C.Vector3, makeVector3(0, 0, 0)), p("MaxForce", C.Vector3, makeVector3(4000, 4000, 4000)), p("P", C.Number, 1250)] },
  BodyAngularVelocity: { extends: "Instance", defaultName: "BodyAngularVelocity", props: [p("AngularVelocity", C.Vector3, makeVector3(0, 0, 0)), p("MaxTorque", C.Vector3, makeVector3(4000, 4000, 4000)), p("P", C.Number, 1250)] },
  BodyForce: { extends: "Instance", defaultName: "BodyForce", props: [p("Force", C.Vector3, makeVector3(0, 0, 0))] },
  BodyThrust: { extends: "Instance", defaultName: "BodyThrust", props: [p("Force", C.Vector3, makeVector3(0, 0, 0)), p("Location", C.Vector3, makeVector3(0, 0, 0))] },
  BodyPosition: { extends: "Instance", defaultName: "BodyPosition", props: [p("Position", C.Vector3, makeVector3(0, 0, 0)), p("MaxForce", C.Vector3, makeVector3(4000, 4000, 4000)), p("P", C.Number, 10000), p("D", C.Number, 1250)] },
  BodyGyro: { extends: "Instance", defaultName: "BodyGyro", props: [p("Orientation", C.Vector3, makeVector3(0, 0, 0)), p("MaxTorque", C.Vector3, makeVector3(3000, 3000, 3000)), p("P", C.Number, 3000), p("D", C.Number, 500)] },


  LinearVelocity: { extends: "Instance", defaultName: "LinearVelocity", props: [p("Enabled", C.Boolean, true), p("VectorVelocity", C.Vector3, makeVector3(0, 0, 0)), p("MaxForce", C.Number, 4000), p("RelativeTo", C.Enum, "World", { options: Enums.ActuatorRelativeTo }), p("Attachment0", C.Instance, null), p("Attachment1", C.Instance, null)] },
  AngularVelocity: { extends: "Instance", defaultName: "AngularVelocity", props: [p("Enabled", C.Boolean, true), p("AngularVelocity", C.Vector3, makeVector3(0, 0, 0)), p("MaxTorque", C.Number, 4000)] },
  VectorForce: { extends: "Instance", defaultName: "VectorForce", props: [p("Enabled", C.Boolean, true), p("Force", C.Vector3, makeVector3(0, 0, 0)), p("RelativeTo", C.Enum, "World", { options: Enums.ActuatorRelativeTo }), p("Attachment0", C.Instance, null), p("Attachment1", C.Instance, null)] },
  Torque: { extends: "Instance", defaultName: "Torque", props: [p("Enabled", C.Boolean, true), p("Torque", C.Vector3, makeVector3(0, 0, 0))] },


  AlignPosition: { extends: "Instance", defaultName: "AlignPosition", props: [p("Enabled", C.Boolean, true), p("Position", C.Vector3, makeVector3(0, 0, 0)), p("MaxForce", C.Number, 10000), p("Responsiveness", C.Number, 10), p("MaxVelocity", C.Number, 1e6), p("RigidityEnabled", C.Boolean, false)] },
  AlignOrientation: { extends: "Instance", defaultName: "AlignOrientation", props: [p("Enabled", C.Boolean, true), p("Orientation", C.Vector3, makeVector3(0, 0, 0)), p("MaxTorque", C.Number, 10000), p("Responsiveness", C.Number, 10), p("MaxAngularVelocity", C.Number, 1e6), p("RigidityEnabled", C.Boolean, false)] },


  Animator: { extends: "Instance", defaultName: "Animator", props: [] },




  AnimationTrack: {
    extends: "Instance",
    defaultName: "AnimationTrack",
    props: [
      p("IsPlaying", C.Boolean, false, { readOnly: true }),
      p("Length", C.Number, 0, { readOnly: true }),
      p("Looped", C.Boolean, false),
      p("Priority", C.Enum, "Idle", { options: Enums.AnimationPriority }),
      p("Speed", C.Number, 1, { readOnly: true }),
      p("TimePosition", C.Number, 0),
      p("WeightCurrent", C.Number, 0, { readOnly: true }),
      p("WeightTarget", C.Number, 0, { readOnly: true }),
    ],
  },


  IKControl: {
    extends: "Instance",
    defaultName: "IKControl",
    props: [
      p("Enabled", C.Boolean, true),
      p("Type", C.Enum, "Transform", { options: Enums.IKControlType }),
      p("EndEffector", C.Instance, null),
      p("Target", C.Instance, null),
      p("ChainRoot", C.Instance, null),
      p("Pole", C.Instance, null),
      p("Priority", C.Number, 0),
      p("Weight", C.Number, 1),
      p("SmoothTime", C.Number, 0),
      p("Offset", C.CFrame, makeCFrame(0, 0, 0)),
    ],
  },

  Humanoid: {
    extends: "Instance",
    defaultName: "Humanoid",
    props: [
      p("DisplayName", C.String, ""),

      p("Health", C.Number, 100),
      p("MaxHealth", C.Number, 100),
      p("BreakJointsOnDeath", C.Boolean, true),
      p("HealthDisplayDistance", C.Number, 100),
      p("HealthDisplayType", C.Enum, "DisplayWhenDamaged", { options: Enums.HumanoidHealthDisplayType }),
      p("NameDisplayDistance", C.Number, 100),

      p("WalkSpeed", C.Number, 16),
      p("JumpPower", C.Number, 50),
      p("JumpHeight", C.Number, 7.2),
      p("UseJumpPower", C.Boolean, true),
      p("AutoRotate", C.Boolean, true),
      p("HipHeight", C.Number, 1.35),
      p("MaxSlopeAngle", C.Number, 89),
      p("WalkToPoint", C.Vector3, makeVector3(0, 0, 0)),
      p("WalkToPart", C.Instance, null),
      p("MoveDirection", C.Vector3, makeVector3(0, 0, 0), { readOnly: true }),


      p("FloorMaterial", C.Enum, "Air", { options: Enums.Material, readOnly: true }),
      p("SeatPart", C.Instance, null, { readOnly: true }),
      p("Sit", C.Boolean, false),
      p("PlatformStand", C.Boolean, false),
      p("Jump", C.Boolean, false),


      p("RigType", C.Enum, "R6", { options: Enums.HumanoidRigType }),
      p("RequiresNeck", C.Boolean, true),
      p("AutomaticScalingEnabled", C.Boolean, true),
      p("BodyHeightScale", C.Number, 1),
      p("BodyWidthScale", C.Number, 1),
      p("BodyDepthScale", C.Number, 1),
      p("HeadScale", C.Number, 1),
      p("AutomaticExtentsMode", C.Enum, "Full", { options: Enums.AutomaticExtentsMode }),
      p("CollisionType", C.Enum, "OuterBox", { options: Enums.HumanoidCollisionType }),
      p("AutoFootPlanting", C.Boolean, true),                                      
      p("FootPlantingMaxOffset", C.Number, 1.5),                                   
    ],
  },

  HumanoidDescription: {
    extends: "Instance",
    defaultName: "HumanoidDescription",
    props: [
      p("Face", C.Number, 0),
      p("Head", C.Number, 0),
      p("Torso", C.Number, 0),
      p("LeftArm", C.Number, 0),
      p("RightArm", C.Number, 0),
      p("LeftLeg", C.Number, 0),
      p("RightLeg", C.Number, 0),
      p("HatAccessory", C.Number, 0),
      p("HairAccessory", C.Number, 0),
      p("FaceAccessory", C.Number, 0),
      p("NeckAccessory", C.Number, 0),
      p("ShouldersAccessory", C.Number, 0),
      p("FrontAccessory", C.Number, 0),
      p("BackAccessory", C.Number, 0),
      p("WaistAccessory", C.Number, 0),
      p("JacketAccessory", C.Number, 0),
      p("SweaterAccessory", C.Number, 0),
      p("ShortsAccessory", C.Number, 0),
      p("LeftShoeAccessory", C.Number, 0),
      p("RightShoeAccessory", C.Number, 0),
      p("DressSkirtAccessory", C.Number, 0),
      p("Shirt", C.Number, 0),
      p("Pants", C.Number, 0),
      p("GraphicTShirt", C.Number, 0),

      p("HeightScale", C.Number, 1),
      p("WidthScale", C.Number, 1),
      p("HeadColor", C.Color, makeColor(0.953, 0.776, 0.565)),
      p("TorsoColor", C.Color, makeColor(0.039, 0.412, 0.675)),
      p("LeftArmColor", C.Color, makeColor(0.953, 0.776, 0.565)),
      p("RightArmColor", C.Color, makeColor(0.953, 0.776, 0.565)),
      p("LeftLegColor", C.Color, makeColor(0.0, 0.643, 0.0)),
      p("RightLegColor", C.Color, makeColor(0.0, 0.643, 0.0)),
    ],
  },

  BodyColors: {
    extends: "Instance",
    defaultName: "Body Colors",
    props: [
      p("HeadColor", C.Color, makeColor(0.953, 0.776, 0.565)),
      p("TorsoColor", C.Color, makeColor(0.039, 0.412, 0.675)),
      p("LeftArmColor", C.Color, makeColor(0.953, 0.776, 0.565)),
      p("RightArmColor", C.Color, makeColor(0.953, 0.776, 0.565)),
      p("LeftLegColor", C.Color, makeColor(0.0, 0.643, 0.0)),
      p("RightLegColor", C.Color, makeColor(0.0, 0.643, 0.0)),
    ],
  },

  Accoutrement: {
    extends: "Instance",
    defaultName: "Accoutrement",
    props: [],
  },

  Accessory: {
    extends: "Accoutrement",
    defaultName: "Accessory",
    props: [p("AccessoryType", C.Enum, "Hat", { options: Enums.AccessoryType })],
  },

  WrapTarget: {
    extends: "Instance",
    defaultName: "WrapTarget",
    props: [
      p("CageMeshId", C.String, ""),
      p("CageOrigin", C.CFrame, makeCFrame(0, 0, 0)),
      p("ImportOrigin", C.CFrame, makeCFrame(0, 0, 0)),
      p("Stiffness", C.Number, 0.5),
      p("Color", C.Color, makeColor(0.2, 0.75, 0.45)),
    ],
  },

  WrapLayer: {
    extends: "Instance",
    defaultName: "WrapLayer",
    props: [
      p("CageMeshId", C.String, ""),
      p("CageOrigin", C.CFrame, makeCFrame(0, 0, 0)),
      p("ImportOrigin", C.CFrame, makeCFrame(0, 0, 0)),
      p("Order", C.Number, 1),
      p("Puffiness", C.Number, 1),
      p("ReferenceMeshId", C.String, ""),
      p("ReferenceOrigin", C.CFrame, makeCFrame(0, 0, 0)),
      p("BindOffset", C.CFrame, makeCFrame(0, 0, 0)),
      p("Enabled", C.Boolean, true),
    ],
  },

  SpecialMesh: {
    extends: "Instance",
    defaultName: "Mesh",
    props: [
      p("MeshId", C.String, ""),
      p("MeshType", C.Enum, "Head", { options: Enums.MeshType }),
      p("Scale", C.Vector3, makeVector3(1, 1, 1)),

      p("TextureId", C.String, ""),
      p("Offset", C.Vector3, makeVector3(0, 0, 0)),
      p("VertexColor", C.Vector3, makeVector3(1, 1, 1)),
    ],
  },


  Decal: {
    extends: "Instance",
    defaultName: "Decal",
    props: [
      p("Texture", C.String, ""),
      p("Face", C.Enum, "Front", { options: Enums.NormalId }),
      p("Color3", C.Color, makeColor(1, 1, 1)),
      p("Transparency", C.Number, 0),
      p("ZIndex", C.Number, 1),
    ],
  },

  Texture: {
    extends: "Instance",
    defaultName: "Texture",
    props: [
      p("Texture", C.String, ""),
      p("Face", C.Enum, "Front", { options: Enums.NormalId }),
      p("Color3", C.Color, makeColor(1, 1, 1)),
      p("Transparency", C.Number, 0),
      p("ZIndex", C.Number, 1),
      p("StudsPerTileU", C.Number, 2),
      p("StudsPerTileV", C.Number, 2),
      p("OffsetStudsU", C.Number, 0),
      p("OffsetStudsV", C.Number, 0),
    ],
  },
  Animation: { extends: "Instance", defaultName: "Animation", props: [p("AnimationId", C.String, "")] },

  KeyframeSequence: { extends: "Instance", defaultName: "Animation", props: [p("Loop", C.Boolean, false), p("Priority", C.Enum, "Idle", { options: Enums.AnimationPriority }), p("Duration", C.Number, 1), p("AssetId", C.Number, 0)] },


  MeshPart: {
    extends: "BasePart",
    defaultName: "MeshPart",
    props: [
      p("MeshId", C.String, ""),
      p("TextureID", C.String, ""),

      p("MeshSize", C.Vector3, makeVector3(1, 1, 1), { readOnly: true }),
      p("CollisionFidelity", C.Enum, "Default", { options: Enums.CollisionFidelity }),
      p("RenderFidelity", C.Enum, "Automatic", { options: Enums.RenderFidelity }),
      p("DoubleSided", C.Boolean, false),
      p("HasJointOffset", C.Boolean, false),

      p("HasSkinnedMesh", C.Boolean, false, { readOnly: true }),
      p("JointOffset", C.Vector3, makeVector3(0, 0, 0)),
    ],
  },

  SurfaceAppearance: {
    extends: "Instance",
    defaultName: "SurfaceAppearance",
    props: [
      p("SubstrateMaterial", C.String, ""),
      p("ColorMap", C.String, ""),
      p("NormalMap", C.String, ""),
      p("MetalnessMap", C.String, ""),
      p("RoughnessMap", C.String, ""),
      p("AlphaMode", C.Enum, "Overlay", { options: Enums.AlphaMode }),
      p("Color", C.Color, makeColor(1, 1, 1)),


      p("NormalMapConvention", C.Enum, "Auto", { options: Enums.NormalMapConvention }),
      p("HeightMap", C.String, ""),
      p("HeightScale", C.Number, 0.02),
      p("DetailColorMap", C.String, ""),
      p("DetailNormalMap", C.String, ""),
      p("DetailTiling", C.Number, 8),
    ],
  },

  MaterialVariant: {
    extends: "Instance",
    defaultName: "MaterialVariant",
    props: [
      p("BaseMaterial", C.Enum, "Plastic", { options: Enums.Material, hiddenOptions: ["Air", "Water"] }),
      p("ColorMap", C.String, ""),
      p("NormalMap", C.String, ""),
      p("MetalnessMap", C.String, ""),
      p("RoughnessMap", C.String, ""),
      p("StudsPerTile", C.Number, 10),
      p("MaterialPattern", C.Enum, "Regular", { options: Enums.MaterialPattern }),


      p("SetAsOverride", C.Boolean, false),
    ],
  },

  MaterialService: {
    extends: "Instance",
    defaultName: "MaterialService",
    service: true,
    props: [p("Use2022Materials", C.Boolean, true)],
  },


  Camera: {
    extends: "Instance",
    defaultName: "Camera",
    props: [
      p("CameraType", C.Enum, "Custom", { options: Enums.CameraType }),
      p("CameraSubject", C.Instance, null),
      p("CFrame", C.CFrame, makeCFrame(0, 20, 20)),
      p("Focus", C.CFrame, makeCFrame(0, 0, 0)),
      p("FieldOfView", C.Number, 70),
      p("FieldOfViewMode", C.Enum, "Vertical", { options: Enums.FieldOfViewMode }),
      p("ViewportSize", C.Vector2, makeVector2(1280, 720), { readOnly: true }),
      p("NearPlaneZ", C.Number, -0.1, { readOnly: true }),
      p("HeadLocked", C.Boolean, false),
      p("HeadScale", C.Number, 1),
    ],
  },


  Terrain: {
    extends: "Instance",
    defaultName: "Terrain",
    props: [
      p("WaterColor", C.Color, makeColor(0.04, 0.34, 0.51)),
      p("WaterReflectance", C.Number, 1),
      p("WaterTransparency", C.Number, 0.3),
      p("WaterWaveSize", C.Number, 0.15),
      p("WaterWaveSpeed", C.Number, 10),
      p("Decoration", C.Boolean, false),
      p("GrassLength", C.Number, 0.4),
      p("TerrainSize", C.Vector3, makeVector3(0, 0, 0), { readOnly: true }),
      p("MaxExtents", C.Vector3, makeVector3(2048, 512, 2048)),
    ],
  },


  Script: {
    extends: "Instance",
    defaultName: "Script",
    props: [
      p("Source", C.String, "-- Script\nprint(\"Hello world!\")\n"),
      p("Disabled", C.Boolean, false),

      p("RunContext", C.Enum, "Legacy", { options: Enums.RunContext }),
    ],
  },
  LocalScript: { extends: "Script", defaultName: "LocalScript", props: [] },
  ModuleScript: {
    extends: "Script",
    defaultName: "ModuleScript",
    props: [],
    overrides: { Source: "local module = {}\n\nreturn module\n" },
  },


  Workspace: {
    extends: "ServiceProvider",
    defaultName: "Workspace",
    props: [
      p("Gravity", C.Number, 196.2),


      p("FallenPartsDestroyHeight", C.Number, -500),
      p("GlobalWind", C.Vector3, makeVector3(0, 0, 0)),

      p("StreamingEnabled", C.Boolean, false),
      p("StreamingMinRadius", C.Number, 64, { integer: true }),
      p("StreamingTargetRadius", C.Number, 256, { integer: true }),
      p("StreamOutBehavior", C.Enum, "Default", { options: Enums.StreamOutBehavior }),
      p("ReplicationFocus", C.Instance, null),
    ],
    service: true,
  },

  ClimateService: {
    extends: "Instance",
    defaultName: "ClimateService",
    service: true,
    props: [
      p("WeatherType", C.Enum, "Clear", { options: Enums.WeatherType }),
      p("Intensity", C.Number, 1),
      p("TransitionTime", C.Number, 5),
      p("WindStrength", C.Number, 0),
      p("WindDirection", C.Vector3, makeVector3(1, 0, 0)),
      p("TemperatureCelsius", C.Number, 22),
      p("AmbientSoundEnabled", C.Boolean, true),
    ],
  },
  ReplicatedStorage: {
    extends: "Instance",
    defaultName: "ReplicatedStorage",
    props: [],
    service: true,
  },


  ReplicatedFirst: {
    extends: "Instance",
    defaultName: "ReplicatedFirst",
    props: [],
    service: true,
  },

  Configuration: {
    extends: "Instance",
    defaultName: "Configuration",
    props: [],
  },
  ServerStorage: {
    extends: "Instance",
    defaultName: "ServerStorage",
    props: [],
    service: true,
  },
  ServerScriptService: {
    extends: "Instance",
    defaultName: "ServerScriptService",
    props: [],
    service: true,
  },
  StarterGui: {
    extends: "Instance",
    defaultName: "StarterGui",
    props: [
      p("ScreenOrientation", C.Enum, "LandscapeSensor", { options: Enums.ScreenOrientation }),
      p("ShowDevelopmentGui", C.Boolean, true),
      p("ResetPlayerGuiOnSpawn", C.Boolean, true),
    ],
    service: true,
  },
  StarterPack: {
    extends: "Instance",
    defaultName: "StarterPack",
    props: [],
    service: true,
  },
  StarterPlayer: {
    extends: "Instance",
    defaultName: "StarterPlayer",
    props: [
      p("CharacterWalkSpeed", C.Number, 16),
      p("CharacterJumpPower", C.Number, 50),

      p("CharacterUseJumpPower", C.Boolean, true),
      p("CharacterJumpHeight", C.Number, 7.2),

      p("CameraMode", C.Enum, "Classic", { options: Enums.CameraMode }),
      p("DevCameraOcclusionMode", C.Enum, "Zoom", { options: Enums.DevCameraOcclusionMode }),

      p("CameraMinZoomDistance", C.Number, 0.5),
      p("CameraMaxZoomDistance", C.Number, 128),
    ],
    service: true,
  },


  StarterPlayerScripts: { extends: "Instance", defaultName: "StarterPlayerScripts", props: [] },
  StarterCharacterScripts: { extends: "Instance", defaultName: "StarterCharacterScripts", props: [] },

  Players: {
    extends: "Instance",
    defaultName: "Players",

    props: [
      p("RespawnTime", C.Number, 5),
      p("MaxPlayers", C.Number, 50, { integer: true, readOnly: true }),
      p("PreferredPlayers", C.Number, 0, { integer: true }),
      p("BubbleChat", C.Boolean, false),
      p("ClassicChat", C.Boolean, true),
      p("CharacterAutoLoads", C.Boolean, true),
    ],
    service: true,
  },

  Player: {
    extends: "Instance",
    defaultName: "Player",
    props: [
      p("DisplayName", C.String, ""),
      p("UserId", C.Number, 1, { integer: true }),
      p("AccountAge", C.Number, 0, { integer: true }),
      p("Character", C.Instance, null),
      p("CharacterAppearanceId", C.Number, 0, { integer: true }),
      p("CharacterAppearanceLoaded", C.Boolean, false, { readOnly: true }),
      p("Team", C.Instance, null),
      p("TeamColor", C.Enum, "White", { options: Enums.BrickColorName }),
      p("Neutral", C.Boolean, true),
      p("HealthDisplayDistance", C.Number, 100),
      p("NameDisplayDistance", C.Number, 100),
      p("ChatMode", C.Enum, "Default", { options: Enums.ChatMode }),
      p("ReplicationFocus", C.Instance, null),

      p("RespawnLocation", C.Instance, null),
      p("AutoJumpEnabled", C.Boolean, true),
      p("CameraMode", C.Enum, "Classic", { options: Enums.CameraMode }),
      p("CameraMaxZoomDistance", C.Number, 128),
      p("CameraMinZoomDistance", C.Number, 0.5),
      p("DevCameraOcclusionMode", C.Enum, "Zoom", { options: Enums.DevCameraOcclusionMode }),
      p("DevComputerCameraMode", C.Enum, "UserChoice", { options: Enums.DevComputerCameraMode }),
      p("DevComputerMovementMode", C.Enum, "UserChoice", { options: Enums.DevComputerMovementMode }),
      p("DevTouchCameraMode", C.Enum, "UserChoice", { options: Enums.DevTouchCameraMode }),
      p("DevTouchMovementMode", C.Enum, "UserChoice", { options: Enums.DevTouchMovementMode }),
      p("DevEnableMouseLock", C.Boolean, true),
      p("LocaleId", C.String, "en-us"),
    ],
  },

  PlayerGui: {
    extends: "Instance",
    defaultName: "PlayerGui",
    props: [
      p("CurrentScreenOrientation", C.Enum, "LandscapeSensor", { options: Enums.ScreenOrientation, readOnly: true }),
      p("ScreenOrientation", C.Enum, "LandscapeSensor", { options: Enums.ScreenOrientation }),
      p("ShowDevelopmentGui", C.Boolean, true),
      p("SelectionImageObject", C.Instance, null),
    ],
  },
  PlayerScripts: { extends: "Instance", defaultName: "PlayerScripts", props: [] },
  Backpack: { extends: "Instance", defaultName: "Backpack", props: [] },
  StarterGear: { extends: "Instance", defaultName: "StarterGear", props: [] },
  LocalizationService: {
    extends: "Instance",
    defaultName: "LocalizationService",
    props: [
      p("RobloxLocaleId", C.String, "en-us", { readOnly: true }),
      p("SystemLocaleId", C.String, "en-us", { readOnly: true }),
    ],
    service: true,
  },

  LocalizationTable: {
    extends: "Instance",
    defaultName: "LocalizationTable",
    props: [
      p("SourceLocaleId", C.String, "en-us"),
      p("Contents", C.String, ""),
    ],
  },


  RemoteEvent: { extends: "Instance", defaultName: "RemoteEvent", props: [] },
  RemoteFunction: { extends: "Instance", defaultName: "RemoteFunction", props: [] },
  BindableEvent: { extends: "Instance", defaultName: "BindableEvent", props: [] },
  BindableFunction: { extends: "Instance", defaultName: "BindableFunction", props: [] },
  SoundService: {
    extends: "Instance",
    defaultName: "SoundService",

    props: [
      p("AmbientReverb", C.Enum, "NoReverb", { options: Enums.ReverbType }),
      p("DistanceFactor", C.Number, 1),
      p("DopplerScale", C.Number, 1),
      p("RespectFilteringEnabled", C.Boolean, false),
      p("RolloffScale", C.Number, 1),
      p("VolumeScale", C.Number, 1),
    ],
    service: true,
  },


  Sound: {
    extends: "Instance",
    defaultName: "Sound",
    props: [
      p("SoundId", C.String, ""),
      p("Volume", C.Number, 0.5),
      p("Pitch", C.Number, 1),
      p("PlaybackSpeed", C.Number, 1),
      p("Looped", C.Boolean, false),
      p("Playing", C.Boolean, false),


      p("IsPlaying", C.Boolean, false, { readOnly: true }),
      p("TimePosition", C.Number, 0),
      p("TimeLength", C.Number, 0, { readOnly: true }),
      p("IsLoaded", C.Boolean, false, { readOnly: true }),
      p("IsPaused", C.Boolean, false, { readOnly: true }),
      p("EmitterSize", C.Number, 10),
      p("MaxDistance", C.Number, 10000),
      p("RollOffMode", C.Enum, "Inverse", { options: Enums.RollOffMode }),
      p("RollOffMinDistance", C.Number, 10),
      p("RollOffMaxDistance", C.Number, 10000),
      p("PlayOnRemove", C.Boolean, false),
      p("SoundGroup", C.Instance, null),
    ],
  },

  SoundGroup: {
    extends: "Instance",
    defaultName: "SoundGroup",
    props: [
      p("Volume", C.Number, 1),
      p("SoundGroup", C.Instance, null),
    ],
  },

  EqualizerSoundEffect: {
    extends: "Instance",
    defaultName: "EqualizerSoundEffect",
    props: [
      p("HighGain", C.Number, 0),
      p("MidGain", C.Number, 0),
      p("LowGain", C.Number, 0),
      p("Enabled", C.Boolean, true),
      p("Priority", C.Number, 0),
    ],
  },
  ReverbSoundEffect: {
    extends: "Instance",
    defaultName: "ReverbSoundEffect",
    props: [
      p("DecayTime", C.Number, 1.5),
      p("Density", C.Number, 1),
      p("Diffusion", C.Number, 1),
      p("DryLevel", C.Number, -6),
      p("WetLevel", C.Number, -6),
      p("Enabled", C.Boolean, true),
      p("Priority", C.Number, 0),
    ],
  },
  DistortionSoundEffect: {
    extends: "Instance",
    defaultName: "DistortionSoundEffect",
    props: [
      p("Level", C.Number, 0.75),
      p("Enabled", C.Boolean, true),
      p("Priority", C.Number, 0),
    ],
  },
  ChorusSoundEffect: {
    extends: "Instance",
    defaultName: "ChorusSoundEffect",
    props: [
      p("Depth", C.Number, 0.45),
      p("Mix", C.Number, 0.5),
      p("Rate", C.Number, 0.5),
      p("Enabled", C.Boolean, true),
      p("Priority", C.Number, 0),
    ],
  },
  CompressorSoundEffect: {
    extends: "Instance",
    defaultName: "CompressorSoundEffect",
    props: [
      p("Attack", C.Number, 0.1),
      p("MakeupGain", C.Number, 0),
      p("Ratio", C.Number, 40),
      p("Release", C.Number, 101),
      p("Threshold", C.Number, -40),
      p("Enabled", C.Boolean, true),
      p("Priority", C.Number, 0),
    ],
  },
  EchoSoundEffect: {
    extends: "Instance",
    defaultName: "EchoSoundEffect",
    props: [
      p("Delay", C.Number, 1),
      p("DryLevel", C.Number, 0),
      p("Feedback", C.Number, 0.5),
      p("WetLevel", C.Number, 0),
      p("Enabled", C.Boolean, true),
      p("Priority", C.Number, 0),
    ],
  },
  FlangeSoundEffect: {
    extends: "Instance",
    defaultName: "FlangeSoundEffect",
    props: [
      p("Depth", C.Number, 0.45),
      p("Mix", C.Number, 0.85),
      p("Rate", C.Number, 5),
      p("Enabled", C.Boolean, true),
      p("Priority", C.Number, 0),
    ],
  },
  PitchShiftSoundEffect: {
    extends: "Instance",
    defaultName: "PitchShiftSoundEffect",
    props: [

      p("Octave", C.Number, 1.25),
      p("Enabled", C.Boolean, true),
      p("Priority", C.Number, 0),
    ],
  },
  TremoloSoundEffect: {
    extends: "Instance",
    defaultName: "TremoloSoundEffect",
    props: [
      p("Depth", C.Number, 1),
      p("Duty", C.Number, 0.5),
      p("Frequency", C.Number, 5),
      p("Enabled", C.Boolean, true),
      p("Priority", C.Number, 0),
    ],
  },
  Lighting: {
    extends: "Instance",
    defaultName: "Lighting",
    service: true,
    props: [
      p("Ambient", C.Color, makeColor(0, 0, 0)),

      p("AmbientOcclusion", C.Boolean, true),


      p("AmbientOcclusionLite", C.Boolean, null, { allowNull: true }),



      p("AutoExposure", C.Boolean, null, { allowNull: true }),
      p("Brightness", C.Number, 2),
      p("ClockTime", C.Number, 14),
      p("ColorShift_Bottom", C.Color, makeColor(0, 0, 0)),
      p("ColorShift_Top", C.Color, makeColor(0, 0, 0)),

      p("ContactShadows", C.Boolean, true),






      p("CsmRodizio", C.Boolean, null, { allowNull: true }),
      p("EnvironmentDiffuseScale", C.Number, 1),
      p("EnvironmentSpecularScale", C.Number, 1),
      p("ExposureCompensation", C.Number, 0),


      p("FeatureBudget", C.Boolean, null, { allowNull: true }),
      p("FogColor", C.Color, makeColor(0.75, 0.75, 0.75)),
      p("FogEnd", C.Number, 100000),
      p("FogStart", C.Number, 0),


      p("ChromaticAberration", C.Number, 0),


      p("FilmGrain", C.Number, 0),
      p("GeographicLatitude", C.Number, 41.73),


      p("GlassRefraction", C.Boolean, null, { allowNull: true }),
      p("GlobalShadows", C.Boolean, true),






      p("HalfResSunShadows", C.Boolean, null, { allowNull: true }),





      p("LocalExposure", C.Boolean, null, { allowNull: true }),


      p("LocalExposureStrength", C.Number, 0.35),




      p("LensFlare", C.Boolean, null, { allowNull: true }),
      p("LensFlareIntensity", C.Number, 0.35),
      p("CinematicPostProcess", C.Boolean, null, { allowNull: true }),


      p("LightPhotometry", C.Boolean, null, { allowNull: true }),


      p("IndexOfRefraction", C.Number, 1.52),


      p("LocalShadowRotation", C.Boolean, true),


      p("MaterialFeatures", C.Boolean, null, { allowNull: true }),


      p("MegaLights", C.Boolean, true),
      p("MegaLightsDebug", C.Boolean, false),

      p("SubstrateEnabled", C.Boolean, null, { allowNull: true }),
      p("SubstrateSM", C.Boolean, SSM_PUBLIC_API.SubstrateSM.default, { allowNull: true }),
      p("SubstrateSMQuality", C.Enum, SSM_PUBLIC_API.SubstrateSMQuality.default, { options: SSM_PUBLIC_API.SubstrateSMQuality.options }),

      p("MegaLightsSM", C.Boolean, null, { allowNull: true }),
      p("MegaLightsSMMode", C.Enum, "A", { options: ["A", "B"] }),
      p("MegaLightsSMStrength", C.Number, MSM_DEFAULT_STRENGTH),
      p("MegaLightsSMView", C.Enum, "Composite", { options: MSM_VIEW_OPTIONS }),





      p("ShadowAtlas", C.Boolean, null, { allowNull: true }),







      p("PlanarReflections", C.Boolean, null, { allowNull: true }),






      p("MotionBlur", C.Boolean, null, { allowNull: true }),


      p("ObjectMotionVectors", C.Boolean, null, { allowNull: true }),


      p("TemporalUpscale", C.Boolean, null, { allowNull: true }),


      p("GlobalIllumination", C.Boolean, null, { allowNull: true }),
      p("OutdoorAmbient", C.Color, makeColor(0.27, 0.27, 0.27)),


      p("PhotoMode", C.Boolean, true),


      p("RayTracedShadows", C.Boolean, false),


      p("RenderStyle", C.Enum, "Classic", { options: Enums.RenderStyle }),


      p("ShadowMapPlus", C.Boolean, null, { allowNull: true }),
      p("ShadowSoftness", C.Number, 0.2),


      p("SkyTurbidity", C.Number, 3),

      p("SkyGroundAlbedo", C.Number, 0.25),
      p("Technology", C.Enum, "ShadowMap", { options: Enums.LightingTechnology }),


      p("TemporalAA", C.Boolean, null, { allowNull: true }),
      p("TimeOfDay", C.String, "14:00:00"),





      p("ToneMapper", C.Enum, "Legacy", { options: Enums.ToneMapper }),


      p("ColorGradingPreset", C.Enum, "None", { options: Enums.ColorGradingPreset }),
      p("WhiteBalanceTemperature", C.Number, 6500),
      p("WhiteBalanceTint", C.Number, 0),
      p("ColorGradingLutAmount", C.Number, 1),



      p("TransparencyShadows", C.Boolean, true),


      p("UpscaleSharpen", C.Boolean, null, { allowNull: true }),


      p("UpscaleSharpenStrength", C.Number, 0.4),


      p("VirtualShadows", C.Boolean, false),








      p("SunClipmap", C.Boolean, null, { allowNull: true }),


      p("VolumetricFog", C.Boolean, null, { allowNull: true }),


      p("LightCluster", C.Boolean, null, { allowNull: true }),


      p("AreaLightParts", C.Boolean, null, { allowNull: true }),

      p("ReflectionProbes", C.Boolean, null, { allowNull: true }),


      p("SSR", C.Boolean, null, { allowNull: true }),
    ],
  },

  Light: {
    abstract: true,
    extends: "Instance",
    defaultName: "Light",
    props: [
      p("Brightness", C.Number, 1),
      p("Color", C.Color, makeColor(1, 1, 1)),
      p("Enabled", C.Boolean, true),


      p("LightPreset", C.Enum, "None", { options: Enums.LightPreset }),
      p("Shadows", C.Boolean, false),


      p("Temperature", C.Number, 0),
    ],
  },
  PointLight: {
    extends: "Light",
    defaultName: "PointLight",
    props: [
      p("Range", C.Number, 8),



      p("SourceRadius", C.Number, 0),


      p("SoftSourceRadius", C.Number, 0),
      p("SourceLength", C.Number, 0),


      p("FilterSharpen", C.Number, 0),
      p("ShadowSlopeBias", C.Number, 0),


      p("ContactShadowLength", C.Number, 0),


      p("IesProfile", C.String, ""),


      p("Intensity", C.Number, 0),
      p("IntensityUnits", C.String, "unitless"),
      p("UseIESBrightness", C.Boolean, false),
      p("IESBrightnessScale", C.Number, 1),
    ],
  },







  RectLight: {
    extends: "Light",
    defaultName: "RectLight",
    props: [
      p("Face", C.Enum, "Front", { options: Enums.NormalId }),
      p("Height", C.Number, 1),
      p("Range", C.Number, 16),
      p("Width", C.Number, 2),


      p("BarnDoorAngle", C.Number, 90),
      p("BarnDoorLength", C.Number, 0),
      p("SourceTexture", C.String, ""),
      p("TwoSided", C.Boolean, false),
    ],
  },


  TubeLight: {
    extends: "Light",
    defaultName: "TubeLight",
    props: [
      p("Face", C.Enum, "Front", { options: Enums.NormalId }),
      p("Length", C.Number, 2),
      p("Range", C.Number, 16),
      p("TubeRadius", C.Number, 0.1),


      p("BarnDoorAngle", C.Number, 90),
      p("BarnDoorLength", C.Number, 0),
      p("SourceTexture", C.String, ""),
      p("TwoSided", C.Boolean, false),
    ],
  },
  SpotLight: {
    extends: "Light",
    defaultName: "SpotLight",
    props: [
      p("Angle", C.Number, 90),
      p("Face", C.Enum, "Front", { options: Enums.NormalId }),
      p("Range", C.Number, 16),

      p("SourceRadius", C.Number, 0),


      p("SoftSourceRadius", C.Number, 0),
      p("SourceLength", C.Number, 0),


      p("FilterSharpen", C.Number, 0),
      p("ShadowSlopeBias", C.Number, 0),


      p("ContactShadowLength", C.Number, 0),


      p("IesProfile", C.String, ""),
      p("LightFunction", C.String, ""),
      p("LightFunctionRotation", C.Number, 0),


      p("Intensity", C.Number, 0),
      p("IntensityUnits", C.String, "unitless"),
      p("UseIESBrightness", C.Boolean, false),
      p("IESBrightnessScale", C.Number, 1),
    ],
  },
  SurfaceLight: {
    extends: "Light",
    defaultName: "SurfaceLight",
    props: [
      p("Angle", C.Number, 90),


      p("Intensity", C.Number, 0),
      p("IntensityUnits", C.String, "unitless"),
      p("UseIESBrightness", C.Boolean, false),
      p("IESBrightnessScale", C.Number, 1),
      p("Face", C.Enum, "Front", { options: Enums.NormalId }),
      p("Range", C.Number, 16),

      p("IesProfile", C.String, ""),
      p("LightFunction", C.String, ""),
      p("LightFunctionRotation", C.Number, 0),
    ],
  },


  ReflectionProbe: {
    extends: "Instance",
    defaultName: "ReflectionProbe",
    props: [
      p("Enabled", C.Boolean, true),
      p("Shape", C.Enum, "Box", { options: ["Box", "Sphere"] }),
      p("Position", C.Vector3, makeVector3(0, 8, 0)),
      p("Size", C.Vector3, makeVector3(32, 16, 32)),
      p("Priority", C.Number, 0, { integer: true }),
      p("Resolution", C.Number, 64),
      p("BlendDistance", C.Number, 2),
    ],
  },


  Clouds: {
    extends: "Instance",
    defaultName: "Clouds",
    props: [
      p("Color", C.Color, makeColor(1, 1, 1)),
      p("Cover", C.Number, 0.5),
      p("Density", C.Number, 0.7),
      p("Enabled", C.Boolean, true),
    ],
  },
  Atmosphere: {
    extends: "Instance",
    defaultName: "Atmosphere",
    props: [
      p("Color", C.Color, makeColor(0.78, 0.81, 0.91)),
      p("Decay", C.Color, makeColor(0.42, 0.44, 0.55)),
      p("Density", C.Number, 0.395),
      p("Glare", C.Number, 0),
      p("Haze", C.Number, 0),
      p("Offset", C.Number, 0),
    ],
  },
  Sky: {
    extends: "Instance",
    defaultName: "Sky",
    props: [
      p("CelestialBodiesShown", C.Boolean, true),

      p("HdriIntensity", C.Number, 1),
      p("MoonAngularSize", C.Number, 11),


      p("MoonPhase", C.Number, 0.5),
      p("MoonTextureId", C.String, ""),
      p("SkyboxBk", C.String, ""),
      p("SkyboxDn", C.String, ""),
      p("SkyboxFt", C.String, ""),

      p("SkyboxHdri", C.String, ""),
      p("SkyboxLf", C.String, ""),
      p("SkyboxRt", C.String, ""),
      p("SkyboxUp", C.String, ""),
      p("StarCount", C.Number, 3000),
      p("SunAngularSize", C.Number, 21),
      p("SunTextureId", C.String, ""),
    ],
  },

  PostEffect: {
    abstract: true,
    extends: "Instance",
    defaultName: "PostEffect",
    props: [p("Enabled", C.Boolean, true)],
  },
  BlurEffect: {
    extends: "PostEffect",
    defaultName: "Blur",
    props: [p("Size", C.Number, 24)],
  },
  BloomEffect: {
    extends: "PostEffect",
    defaultName: "Bloom",
    props: [
      p("Intensity", C.Number, 1),
      p("Size", C.Number, 24),
      p("Threshold", C.Number, 1),


      p("Mode", C.Enum, "Classic", { options: Enums.BloomMode }),
      p("Anamorphic", C.Number, 1),
      p("Dirt", C.Number, 0),
    ],
  },
  ColorCorrectionEffect: {
    extends: "PostEffect",
    defaultName: "ColorCorrection",
    props: [
      p("Brightness", C.Number, 0),
      p("Contrast", C.Number, 0),
      p("Saturation", C.Number, 0),
      p("TintColor", C.Color, makeColor(1, 1, 1)),
    ],
  },
  DepthOfFieldEffect: {
    extends: "PostEffect",
    defaultName: "DepthOfField",
    props: [
      p("FarIntensity", C.Number, 0.75),
      p("FocusDistance", C.Number, 0.05),
      p("InFocusRadius", C.Number, 10),
      p("NearIntensity", C.Number, 0.75),
    ],
  },
  SunRaysEffect: {
    extends: "PostEffect",
    defaultName: "SunRays",
    props: [
      p("Intensity", C.Number, 0.25),
      p("Spread", C.Number, 1),
    ],
  },
  Teams: { extends: "Instance", defaultName: "Teams", props: [], service: true },

  Team: {
    extends: "Instance",
    defaultName: "Team",
    props: [
      p("TeamColor", C.Enum, "White", { options: Enums.BrickColorName }),
      p("Score", C.Number, 0),
      p("AutoAssignable", C.Boolean, true),
      p("AutoColorCharacters", C.Boolean, true),
    ],
  },

  TextChatService: {
    extends: "Instance",
    defaultName: "TextChatService",
    props: [
      p("ChatVersion", C.Enum, "TextChatService", { options: Enums.ChatVersion }),
      p("CreateDefaultCommands", C.Boolean, true),
      p("CreateDefaultTextChannels", C.Boolean, true),
    ],
    service: true,
  },
  TextChannel: { extends: "Instance", defaultName: "TextChannel", props: [] },
  TextChatCommand: {
    extends: "Instance",
    defaultName: "TextChatCommand",
    props: [
      p("PrimaryAlias", C.String, ""),
      p("SecondaryAlias", C.String, ""),
      p("Enabled", C.Boolean, true),
    ],
  },


  TweenService: { extends: "Instance", defaultName: "TweenService", props: [], service: true },


  UserInputService: {
    extends: "Instance",
    defaultName: "UserInputService",
    service: true,
    props: [

      p("KeyboardEnabled", C.Boolean, true, { readOnly: true }),
      p("MouseEnabled", C.Boolean, true, { readOnly: true }),
      p("TouchEnabled", C.Boolean, false, { readOnly: true }),
      p("GamepadEnabled", C.Boolean, false, { readOnly: true }),
      p("GyroscopeEnabled", C.Boolean, false, { readOnly: true }),                              
      p("AccelerometerEnabled", C.Boolean, false, { readOnly: true }),                              
      p("ModalEnabled", C.Boolean, false, { readOnly: true }),
      p("OnScreenKeyboardVisible", C.Boolean, false, { readOnly: true }),
      p("MouseBehavior", C.Enum, "Default", { options: Enums.MouseBehavior }),
      p("MouseDeltaSensitivity", C.Number, 1),                                 
      p("MouseIconEnabled", C.Boolean, true),
    ],
  },
  ContextActionService: { extends: "Instance", defaultName: "ContextActionService", props: [], service: true },


  CollectionService: { extends: "Instance", defaultName: "CollectionService", props: [], service: true },




  ValueBase: { abstract: true, extends: "Instance", defaultName: "Value", props: [] },
  StringValue: { extends: "ValueBase", defaultName: "StringValue", props: [p("Value", C.String, "")] },
  BoolValue: { extends: "ValueBase", defaultName: "BoolValue", props: [p("Value", C.Boolean, false)] },
  IntValue: { extends: "ValueBase", defaultName: "IntValue", props: [p("Value", C.Number, 0, { integer: true })] },
  NumberValue: { extends: "ValueBase", defaultName: "NumberValue", props: [p("Value", C.Number, 0)] },
  ObjectValue: { extends: "ValueBase", defaultName: "ObjectValue", props: [p("Value", C.Instance, null)] },
  Color3Value: { extends: "ValueBase", defaultName: "Color3Value", props: [p("Value", C.Color, makeColor(1, 1, 1))] },
  BrickColorValue: {
    extends: "ValueBase",
    defaultName: "BrickColorValue",
    props: [p("Value", C.Enum, "Medium stone grey", { options: Enums.BrickColorName })],
  },
  Vector3Value: { extends: "ValueBase", defaultName: "Vector3Value", props: [p("Value", C.Vector3, makeVector3(0, 0, 0))] },
  CFrameValue: { extends: "ValueBase", defaultName: "CFrameValue", props: [p("Value", C.CFrame, makeCFrame(0, 0, 0))] },
  RayValue: {
    extends: "ValueBase",
    defaultName: "RayValue",
    props: [p("Value", C.Ray, makeRay({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }))],
  },

  IntConstrainedValue: {
    extends: "ValueBase",
    defaultName: "IntConstrainedValue",
    props: [
      p("Value", C.Number, 0, { integer: true }),
      p("MinValue", C.Number, 0, { integer: true }),
      p("MaxValue", C.Number, 100, { integer: true }),
    ],
  },
  DoubleConstrainedValue: {
    extends: "ValueBase",
    defaultName: "DoubleConstrainedValue",
    props: [
      p("Value", C.Number, 0),
      p("MinValue", C.Number, 0),
      p("MaxValue", C.Number, 100),
    ],
  },
};

const _resolvedCache = new Map();


const DYNAMIC_DEFS = new Map();
const MAX_DYNAMIC_CLASSES = 256;

const DYNAMIC_CLASS_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,119}$/;


export function registerDynamicClass(className) {
  if (typeof className !== "string" || !DYNAMIC_CLASS_NAME_RE.test(className)) return null;
  if (DEFS[className]) return null;                                  
  const existing = DYNAMIC_DEFS.get(className);
  if (existing) return existing;
  if (DYNAMIC_DEFS.size >= MAX_DYNAMIC_CLASSES) return null;
  const def = {
    extends: "Instance",
    defaultName: className,
    props: [],
    dynamic: true,
  };
  DYNAMIC_DEFS.set(className, def);

  _resolvedCache.delete(className);
  return def;
}

export function isDynamicClass(className) {
  return DYNAMIC_DEFS.has(className);
}

export function listDynamicClasses() {
  return [...DYNAMIC_DEFS.keys()];
}

export function getClassDef(className) {
  return DEFS[className] || DYNAMIC_DEFS.get(className) || null;
}


export function isClass(className) {
  return !!DEFS[className];
}

export function isServiceClass(className) {
  const d = DEFS[className];
  return !!(d && d.service);
}

export function listServiceClasses() {
  return Object.keys(DEFS).filter((k) => DEFS[k].service);
}


const ABSTRACT_CLASSES = new Set([
  "Instance",
  "ServiceProvider",
  "BasePart",
  "DataModel",

  "PartOperation",
  "UnionOperation",
  "NegateOperation",

  "ValueBase",
]);


export function isInsertableClass(className) {
  const d = DEFS[className];
  return !!(d && !d.service && !ABSTRACT_CLASSES.has(className));
}


export function listInsertableClasses() {
  return Object.keys(DEFS).filter(isInsertableClass).sort();
}


export function getResolvedProperties(className) {
  if (_resolvedCache.has(className)) return _resolvedCache.get(className);
  const chain = [];
  let cur = className;
  while (cur) {


    const def = getClassDef(cur);
    if (!def) break;
    chain.unshift(def);                 
    cur = def.extends;
  }
  const byName = new Map();
  for (const def of chain) {
    for (const pr of def.props || []) {
      byName.set(pr.name, { ...pr });
    }
    if (def.overrides) {
      for (const [k, v] of Object.entries(def.overrides)) {
        if (byName.has(k)) byName.set(k, { ...byName.get(k), default: v });
      }
    }
  }
  const resolved = [...byName.values()];
  _resolvedCache.set(className, resolved);
  return resolved;
}
