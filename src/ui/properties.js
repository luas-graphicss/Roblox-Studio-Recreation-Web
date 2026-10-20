import { setWeather as climSetWeather, stopWeather as climStopWeather } from "../climate/climateRuntime.js";            
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { createIcon } from "./icons.js";
import { selection } from "../core/selection.js";
import { MSM_PUBLIC_API } from '../lighting/megalightsSm/msmPublicApiCore.js';
import { SUBSTRATE_PUBLIC_API } from '../lighting/substratePublicApi.js';
import {
  Events,
  PropTypes,
  makeColor,
  makeVector3,
  makeUDim,
  makeUDim2,
  makeVector2,
  makeRect,
  valuesEqual,
  getResolvedProperties,
} from "../datamodel/index.js";
import { clampNumber, isFiniteNumber } from "../utils/validate.js";


import { createListenerScope } from "../core/listenerScope.js";

import { previewSoundInstance, stopAudioPreview, isAudioPreviewActive } from "../audio/audioEngine.js";

import {
  openNumberSequenceEditor,
  openColorSequenceEditor,
  drawNumberSequencePreview,
  drawColorSequencePreview,
} from "./sequenceEditors.js";

import { commands } from "../core/commands.js";
import { openModal, openPrompt, makeButton } from "./modal.js";
import { openContextMenu } from "./contextMenu.js";
import { Enums } from "../datamodel/index.js";
import {
  ATTRIBUTE_TYPES,
  ATTRIBUTE_TYPE_LABELS,
  attributeTypeToPropType,
  validateAttributeName,
  coerceAttributeValue,
  defaultAttributeValue,
} from "../datamodel/attributes.js";


const CLASS_ICON = {
  DataModel: "datamodel", Workspace: "workspace", Camera: "camera", Terrain: "terrain",
  Part: "part", BasePart: "part", Model: "model", Folder: "folder",
  Script: "script", LocalScript: "localscript", ModuleScript: "modulescript",
  Lighting: "lighting", ReplicatedStorage: "replicatedstorage", ServerStorage: "serverstorage",
  ServerScriptService: "serverscriptservice", StarterGui: "startergui", StarterPack: "starterpack",
  StarterPlayer: "starterplayer", SoundService: "soundservice", Teams: "teams",
  TweenService: "tweenservice",            
  UserInputService: "userinputservice",            
  ContextActionService: "contextactionservice",            
  Humanoid: "avatar", HumanoidDescription: "shirt", BodyColors: "body", Accessory: "accessory",
  SpawnLocation: "part", TrussPart: "part", ForceField: "instance",            
  SpecialMesh: "part", Motor6D: "move", Attachment: "instance",

  ScreenGui: "screengui", BillboardGui: "billboardgui", SurfaceGui: "surfacegui",
  Frame: "frame", ScrollingFrame: "scrollingframe", ViewportFrame: "viewportframe",
  TextLabel: "textlabel", ImageLabel: "imagelabel", TextButton: "textbutton",
  ImageButton: "imagebutton", TextBox: "textbox", VideoFrame: "videoframe",
  SelectionBox: "selectionbox", UIListLayout: "uilayout", UIPageLayout: "uilayout",
  UIGridLayout: "uigrid", UITableLayout: "uigrid", UIAspectRatioConstraint: "uiconstraint",
  UISizeConstraint: "uiconstraint", UITextSizeConstraint: "uiconstraint",
  UICorner: "uicorner", UIStroke: "uistroke", UIGradient: "uigradient", UIPadding: "uipadding",

  StringValue: "stringvalue", BoolValue: "boolvalue", IntValue: "intvalue", NumberValue: "numbervalue",
  ObjectValue: "objectvalue", Color3Value: "color3value", BrickColorValue: "brickcolorvalue",
  Vector3Value: "vector3value", CFrameValue: "cframevalue", RayValue: "rayvalue",
  IntConstrainedValue: "intconstrainedvalue", DoubleConstrainedValue: "doubleconstrainedvalue",
};
const iconNameFor = (c) => CLASS_ICON[c] || "instance";


const CATEGORY_ORDER = ["Transform", "Appearance", "Behavior", "Data", "Camera", "Lighting"];


const PROP_CATEGORY = {
  ClassName: "Data", Name: "Data", Source: "Data", ClockTime: "Data",
  Size: "Transform", Position: "Transform", Rotation: "Transform",
  Anchored: "Transform", CanCollide: "Transform",
  Color: "Appearance", Material: "Appearance", Transparency: "Appearance", CastShadow: "Appearance",
  Ambient: "Appearance", OutdoorAmbient: "Appearance", Brightness: "Appearance",
  GlobalShadows: "Appearance", FogStart: "Appearance", FogEnd: "Appearance",

  AmbientOcclusion: "Appearance", ContactShadows: "Appearance",
  SubstrateEnabled: "Lighting",
  MegaLightsDebug: "Lighting", SubstrateMaterial: "Appearance",
  MegaLightsSM: "Lighting", MegaLightsSMMode: "Lighting", MegaLightsSMStrength: "Lighting", MegaLightsSMView: "Lighting",

  RayTracedShadows: "Appearance",
  Disabled: "Behavior",
  CameraType: "Camera", FieldOfView: "Camera",

  AnchorPoint: "Transform", ZIndex: "Transform", LayoutOrder: "Transform",
  BackgroundColor3: "Appearance", BackgroundTransparency: "Appearance", BorderSizePixel: "Appearance",
  Image: "Appearance", ImageColor3: "Appearance", ImageTransparency: "Appearance", ScaleType: "Appearance",
  TextColor3: "Appearance", TextSize: "Appearance", Font: "Appearance", TextWrapped: "Appearance",
  TextXAlignment: "Appearance", TextYAlignment: "Appearance", RichText: "Appearance",
  Thickness: "Appearance", CornerRadius: "Appearance", Offset: "Appearance", Rotation: "Transform",
  Visible: "Behavior", ClipsDescendants: "Behavior", Enabled: "Behavior", Active: "Behavior",
  Text: "Data", PlaceholderText: "Data", PlaceholderColor3: "Appearance",
  ScrollingEnabled: "Behavior", CanvasSize: "Transform", ScrollBarThickness: "Appearance",
  FillDirection: "Behavior", HorizontalAlignment: "Behavior", VerticalAlignment: "Behavior",
  SortOrder: "Behavior", Padding: "Transform", CellSize: "Transform", CellPadding: "Transform",
  AspectRatio: "Behavior", AspectType: "Behavior", DominantAxis: "Behavior",
  MinSize: "Transform", MaxSize: "Transform", MinTextSize: "Appearance", MaxTextSize: "Appearance",
  ApplyStrokeMode: "Appearance", DisplayOrder: "Behavior", IgnoreGuiInset: "Behavior",
  ResetOnSpawn: "Behavior", Face: "Appearance", StudsOffset: "Transform",
};


const PROP_DESC = {
  MegaLightsDebug: "Temporary MegaLights diagnostics and reversible tests. Active only with Technology Future. Closing restores debug changes.",
  SubstrateEnabled: SUBSTRATE_PUBLIC_API.SubstrateEnabled.description,
  SubstrateMaterial: SUBSTRATE_PUBLIC_API.SubstrateMaterial.description,
  MegaLightsSM: MSM_PUBLIC_API.MegaLightsSM.description,
  MegaLightsSMMode: MSM_PUBLIC_API.MegaLightsSMMode.description,
  MegaLightsSMStrength: MSM_PUBLIC_API.MegaLightsSMStrength.description,
  MegaLightsSMView: MSM_PUBLIC_API.MegaLightsSMView.description,
  ClassName: "Classe da instância (somente leitura).",
  Name: "Nome da instância.",
  Size: "Dimensões (X, Y, Z) em studs.",
  Position: "Posição no mundo (X, Y, Z).",
  Rotation: "Rotação em graus (X, Y, Z).",
  Anchored: "Se verdadeiro, a parte ignora a física.",
  CanCollide: "Se a parte colide com outras.",
  CastShadow: "Se a parte projeta sombra.",
  Color: "Cor da parte (Color3).",
  Material: "Material visual/físico.",
  Transparency: "0 = opaco, 1 = invisível.",
  Source: "Código-fonte do script.",
  Disabled: "Se o script está desabilitado.",
  CameraType: "Modo de controle da câmera.",
  FieldOfView: "Campo de visão em graus.",
  Brightness: "Intensidade da luz global.",
  ClockTime: "Hora do dia (0–24).",
  AmbientOcclusion: "Oclusão ambiente em tela (GTAO). Efetiva na Technology Future.",
  AmbientOcclusionLite: "GTAO-lite a ¼ de resolução para GPU fraca (F10). Liga o GTAO no perfil fraco (tier low) com 4 taps espirais + LUT. F24: sem valor definido = AUTO (liga sozinho na GPU fraca com Future+GlobalShadows); marcar/desmarcar vira escolha explícita; GPU forte segue opt-in.",
  CsmRodizio: "CSM 4 cascatas em rodízio para GPU fraca (F6): cascata 0 quente + fantasmas em round-robin no cache de páginas (VSM). F24: sem valor definido = AUTO (liga sozinho na GPU fraca com Future+GlobalShadows); marcar/desmarcar vira escolha explícita; GPU forte nunca entra.",
  FeatureBudget: "Governor 'mosaico' por feature para GPU fraca (F19). Compra CSM, AO, SSCS, far, vidro, GI extra e RT-ócio pelo orçamento de frame (ledger F1), vende sob pressão e tem kill-switch anti-TDR. F24: sem valor definido = AUTO (liga sozinho na GPU fraca com Future+GlobalShadows); marcar/desmarcar vira escolha explícita; GPU forte segue sem efeito.",
  ContactShadows: "Sombras de contato em tela (micro-contato na base dos objetos). Efetivas na Technology Future.",
  RayTracedShadows: "Sombras do sol por ray tracing progressivo (refina no ócio, câmera parada). Technology Future + GlobalShadows obrigatórios.",
  HalfResSunShadows: "Sombra do sol PCSS em meia resolução com acumulação temporal (F5). Alivia a GPU fraca sem mudar o visual parado; RT ligado tem prioridade. F24: sem valor definido = AUTO (liga sozinho na GPU fraca com Future+GlobalShadows); marcar/desmarcar vira escolha explícita; GPU forte segue opt-in.",
  ShadowMapPlus: "Qualidade mínima do modo ShadowMap (F38). Penumbra dinâmica pela posição do sol, mapa com texel-alvo (~0,35 stud) e luzes locais com borda suave. Sem valor definido = AUTO (liga só na Technology ShadowMap); marcar/desmarcar vira escolha explícita; Voxel/Future seguem intactos.",
  GlassRefraction: "Refração real de vidro (IL-F12). Glass/Ice/Glacier mostram a cena atrás deles (grab compartilhado em meia resolução; gelo/glacier ficam foscos via mips). Sem valor definido = AUTO (liga onde suportado; OFF no tier micro da GPU fraca e na Compatibility); false = clássico por opacidade; true força onde suportado.",
  IndexOfRefraction: "Índice de refração do material Glass (IL-F12). 1.0 = sem desvio; 1.52 = vidro crown (padrão). Clamp [1, 3]; muda ao vivo, sem recompilar.",
  LightCluster: "Cluster de luzes IL-F28: grade 16×9×24 em view space — centenas de luzes com custo estável; especular GGX nos metais. Vazio = AUTO (Future + GPU forte + MegaLights); true força; false desliga. GPU fraca: caminho atual mantido.",
  AreaLightParts:
    "Área lights nos pools de Parts (IL-F37): RectLight/TubeLight passam a iluminar chão/paredes feitos de parts primitivas (Phong) via MRP/LTC-lite por uniform — sem recompilar shader. Vazio = AUTO (Realistic + Future, GPU forte); true força; false desliga. GPU fraca: sempre OFF (aceite da fase).",
  MaterialFeatures: "Lobos físicos de material no Realistic (IL-F11): clearcoat (plástico polido/mármore), anisotropia (metal escovado), sheen (tecidos) e SSS-lite (grama/couro/neve/gelo) por uniform — um único shader, zero variantes. Vazio = AUTO (segue RenderStyle Realistic fora da GPU fraca); true força; false desliga. Classic segue byte a byte.",
  RenderStyle: "Interruptor mestre do plano de iluminação realista. Classic (padrão) = visual atual byte a byte; Realistic liga as fases físicas: fotometria IL-F4 (sol/céu/lua em lux normalizados por EV100 — meio-dia EV~15, noite EV~-2; Brightness vira stops fotográficos, 2 = neutro), HDR do pós (IL-F2), materiais físicos IL-F7 (tabela dos 38 materiais por valor), emissivos em nits (IL-F13) e céu físico (IL-F14).",
  ToneMapper: "Curva de tone mapping do pass final (IL-F3). Legacy = sRGB direto (byte a byte com o visual clássico); AgX = rolloff fílmico recomendado (highlights sem estourar); ACES = look de cinema; PBRNeutral = cores fiéis ao material (Khronos). Aplicada depois do ColorCorrection/grade, antes do sRGB.",
  ColorGradingPreset: "Preset de color grading (IL-F31). None = sem LUT (byte a byte); FilmicCool = azul-frio fílmico; Golden = âmbar quente; Noir = dessaturado cinemático. Aplicado por último, após a conversão sRGB (espaço de display, como a .cube é autorada). LUT .cube explícita (console) tem prioridade.",
  WhiteBalanceTemperature: "Temperatura de cor do white balance (IL-F31): 1500–15000 K. 6500 K = neutro (identidade exata); abaixo esfria (azulado); acima esquenta (âmbar). Aplicado PRÉ-tonemap no espaço linear da cena.",
  WhiteBalanceTint: "Tint do white balance (IL-F31): -1 = verde, 0 = neutro, +1 = magenta. Offset perpendicular ao locus planckiano. Aplicado junto com WhiteBalanceTemperature, PRÉ-tonemap.",
  ColorGradingLutAmount: "Dose da LUT de color grading (IL-F31): 0 = desliga (sem custo), 1 = LUT completa. Interpola entre o sinal sem LUT e o processado.",
  SkyTurbidity: "Turbidez do céu físico (IL-F14): 1.7 = céu limpo profundo, 10 = bruma pesada lavando o azul. Só tem efeito com Lighting.RenderStyle Realistic.",
  SkyGroundAlbedo: "Albedo do chão do céu físico (IL-F14): tinge o hemisfério abaixo do horizonte. Só tem efeito com Lighting.RenderStyle Realistic.",

  GlobalIllumination:
    "GI dinâmica (IL-F39): multi-bounce voxel + emissivos Neon + especular de GI. " +
    "AUTO no Realistic Future GPU forte; true força (lite no fraco); false veta.",
  PlanarReflections: "Reflexo planar real (IL-F23): água do terreno + Parts espelho refletem a cena de verdade (½ res, teto 1280, near plane oblíquo). 1 plano ativo por frame (o de maior peso na tela). Vazio = AUTO (liga com RenderStyle Realistic na GPU forte; OFF no perfil fraco — aceite da fase); true força na GPU forte; false desliga.",
  Mirror: "Marca a Part como espelho planar (IL-F23). A face mais fina vira a superfície reflexiva (ex.: laje 8×0.2×6 espelha para cima; quadro 4×6×0.2 espelha pela frente). Reflexo via overlay UV projetivo com Fresnel e fade de borda. Só tem efeito com Lighting.PlanarReflections AUTO ou true.",
  LightPhotometry: "Fotometria real das luzes locais (IL-F27): Brightness vira lúmens (800 lm/unidade), candela pela abertura do cone, falloff 1/d² físico e Kelvin (Temperature/LightPreset) com cores de vida real. Vazio = AUTO (segue RenderStyle Realistic); true força (até no Classic); false desliga. Coerente com o EV100 da cena: a mesma lâmpada some de dia e domina à noite.",
  Temperature: "Temperatura de cor em Kelvin (IL-F27): 0 = desligada (Color pura); 1000–12000 K aplica o tint Planck fisicamente correto por cima da Color (luminância preservada). Vela ≈1900 K, tungstênio 2700 K, LED 4000 K, sódio 2200 K, céu 10000 K+. Precisa da fotometria ligada (Lighting.LightPhotometry).",
  LightPreset: "Preset fotométrico real (IL-F27): Candle 1900 K/12 lm, Tungsten 2700 K/800 lm, Halogen 3000 K/1600 lm, LED 4000 K/800 lm, Fluorescent 5000 K/1100 lm, Sodium 2200 K/6000 lm, Daylight 6500 K/1600 lm. Sobrepõe Temperature/Brightness quando a fotometria está ligada; None = manual.",

  TemporalAA: "TAA-lite (IL-F32): anti-aliasing temporal com jitter sub-pixel, reprojeção e clamp 3×3 anti-ghosting. Tri-state: vazio = AUTO (hoje OFF, opt-in até calibrar); ligado = força na GPU forte (perfil fraco veta sempre); desligado = veta.",
  MotionBlur: "Motion blur de CÂMERA (IL-F32): reprojeção por depth, 8 taps, shutter 180°. Tri-state: vazio = AUTO (hoje OFF fora do photo/play); ligado = força na GPU forte; desligado = veta.",

  ObjectMotionVectors: "Motion vectors de objetos rígidos (IL-F40): pass de velocidade ½-res para MB de objeto e reprojeção TAA. Tri-state: vazio = AUTO (liga com MB/TAA na GPU forte); ligado = força (fraco veta); desligado = veta.",
  TemporalUpscale: "Upscale temporal (IL-F40): render em escala < 1 + reconstrução temporal. AUTO OFF (opt-in futuro — ADAPTIVE_RES_OFF=true); ligado = só com TAA on na GPU forte; desligado = veta.",
  ChromaticAberration: "Aberração cromática (IL-F32): offset RGB radial nas bordas da tela. 0 = OFF byte a byte; doses baixas (0.1–0.3) = look de lente real.",
  FilmGrain: "Film grain HDR-aware (IL-F32): aplicado pós-tonemap e pré-OETF sRGB, amplitude por luminância — sombras granulam como filme, highlights limpos. 0 = OFF byte a byte.",
};


const NUMBER_RANGE = {
  Transparency: { min: 0, max: 1, step: 0.05 },

  HeightScale: { min: 0, max: 0.2, step: 0.005 },
  DetailTiling: { min: 0.05, max: 256, step: 0.5 },
  FieldOfView: { min: 1, max: 120, step: 1 },
  Brightness: { min: 0, max: 10, step: 0.1 },
  ClockTime: { min: 0, max: 24, step: 0.5 },

  IndexOfRefraction: { min: 1, max: 3, step: 0.01 },
  FogStart: { min: 0, max: 1e6, step: 10 },
  FogEnd: { min: 0, max: 1e6, step: 10 },


  ZIndex: { min: 0, max: 10000, step: 1 },
  BackgroundTransparency: { min: 0, max: 1, step: 0.05 },
  ImageTransparency: { min: 0, max: 1, step: 0.05 },
  TextSize: { min: 1, max: 100, step: 1 },
  BorderSizePixel: { min: 0, max: 100, step: 1 },
  ScrollBarThickness: { min: 0, max: 100, step: 1 },
  Thickness: { min: 0, max: 1000, step: 0.5 },
  Volume: { min: 0, max: 10, step: 0.1 },
  DisplayOrder: { min: -1000, max: 1000, step: 1 },
  MinTextSize: { min: 1, max: 100, step: 1 },
  MaxTextSize: { min: 1, max: 100, step: 1 },
  AspectRatio: { min: 0.01, max: 1000, step: 0.1 },

  SkyTurbidity: { min: 1.7, max: 10, step: 0.1 },
  SkyGroundAlbedo: { min: 0, max: 1, step: 0.05 },

  Temperature: { min: 0, max: 12000, step: 50 },

  ChromaticAberration: { min: 0, max: 1, step: 0.05 },
  FilmGrain: { min: 0, max: 1, step: 0.05 },
};


const SYNTHETIC = [
  {
    name: "ClassName", type: PropTypes.String, readOnly: true, options: null,
    synthetic: true, get: (it) => it.className,
  },
];


const CLASSIC_COLORS = [
  ["White", "#f2f3f3"], ["Light stone grey", "#c7c9c9"], ["Medium stone grey", "#a3a2a5"],
  ["Dark stone grey", "#6d6e6c"], ["Black", "#1b2a35"], ["Really black", "#0d0d0d"],
  ["Bright red", "#c4281c"], ["Really red", "#d80027"], ["Bright orange", "#d98c1d"],
  ["Bright yellow", "#f5cd30"], ["New Yeller", "#fff200"], ["Bright green", "#4b974b"],
  ["Lime green", "#00a800"], ["Bright blue", "#0d69ac"], ["Really blue", "#0000ff"],
  ["Navy blue", "#21294d"], ["Cyan", "#02b9e0"], ["Bright purple", "#8a4ea6"],
  ["Magenta", "#a4348a"], ["Pink", "#e89bb0"], ["Brown", "#7c5c46"],
  ["Reddish brown", "#603018"], ["Sand green", "#789082"], ["Earth green", "#3a5039"],
];

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}
function clamp01(n) {
  return isFiniteNumber(n) ? Math.min(1, Math.max(0, n)) : 0;
}
function fmtNum(n) {
  if (!isFiniteNumber(n)) return "";
  return String(Math.round(n * 1000) / 1000);
}
function colorToCss(c) {
  return `rgb(${Math.round(clamp01(c.r) * 255)}, ${Math.round(clamp01(c.g) * 255)}, ${Math.round(clamp01(c.b) * 255)})`;
}
function byteHex(n) {
  return Math.round(clamp01(n) * 255).toString(16).padStart(2, "0");
}
function colorToHex(c) {
  return `#${byteHex(c.r)}${byteHex(c.g)}${byteHex(c.b)}`;
}
function hexToColor(str) {
  if (typeof str !== "string") return null;
  let s = str.trim().replace(/^#/, "");
  if (s.length === 3) s = s.split("").map((x) => x + x).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  return makeColor(r, g, b);
}

export function buildProperties(body) {
  if (!body) throw new Error("Properties: corpo do painel ausente.");
  selection.wire();
  body.classList.add("rsw-props");
  body.setAttribute("role", "grid");
  body.setAttribute("aria-label", "Properties Panel");

  const header = el("div", "rsw-props__header");
  const bodyEl = el("div", "rsw-props__body");

  const attrBody = el("div", "rsw-props__attrs");
  body.replaceChildren(header, bodyEl, attrBody);


  let current = [];                                 
  let signature = null;                                           
  const editors = new Map();                                      
  const sections = new Map();                                                       
  const collapsed = new Set();                                              
  const attrDescriptors = new Map();                                           
  const attrEditors = new Map();                                          
  let attrCollapsed = false;


  function readValue(d) {
    if (current.length === 0) return { empty: true };
    const get = d.attribute
      ? (it) => it.getAttribute(d.name)
      : (d.synthetic ? d.get : (it) => it.getProperty(d.name));
    let v = get(current[0]);
    for (let i = 1; i < current.length; i++) {
      if (!valuesEqual(d.type, v, get(current[i]))) return { mixed: true };
    }
    return { value: v };
  }

  function applyValue(name, value) {
    const ad = attrDescriptors.get(name);
    if (ad) { applyAttributeValue(ad, value); return; }
    for (const it of current) {
      if (it && typeof it.isDestroyed === "function" && !it.isDestroyed()) {
        it.setProperty(name, value);                                         
      }
    }
  }

  function markFocus(node, on) {
    node.classList.toggle("is-focused", !!on);
  }


  function stringEditor(d) {
    const multiline = d.name === "Source";
    const input = document.createElement(multiline ? "textarea" : "input");
    if (!multiline) input.type = "text";
    input.className = "rsw-ed rsw-ed__text" + (multiline ? " rsw-ed__text--multi" : "");
    let editing = false;
    if (d.readOnly) {
      input.disabled = true;
      input.classList.add("is-readonly");
    } else {
      input.addEventListener("focus", () => { editing = true; markFocus(input, true); });
      input.addEventListener("blur", () => { editing = false; markFocus(input, false); commit(); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !multiline) { e.preventDefault(); input.blur(); }
      });
    }
    function commit() {
      if (d.readOnly) return;
      applyValue(d.name, String(input.value));
    }
    function refresh() {
      if (editing) return;
      const r = readValue(d);
      if (r.mixed) { input.value = ""; input.placeholder = "\u2014"; }
      else { input.value = r.value == null ? "" : String(r.value); input.placeholder = ""; }
    }


    const pickSection = ASSET_ID_PROPS[d.name];
    if (pickSection && !d.readOnly && !multiline) {
      const wrap = el("div", "rsw-ed rsw-ed__assetwrap");
      input.classList.add("rsw-ed__text--asset");
      const browse = document.createElement("button");
      browse.type = "button";
      browse.className = "rsw-ed__browse";
      browse.textContent = "Browse";
      browse.title = "Escolher asset no Asset Manager (duplo clique seleciona)";
      browse.addEventListener("click", () => {
        bus.emit("assetmanager:pick", {
          section: pickSection,
          onPick: (assetId) => {
            applyValue(d.name, String(assetId || ""));
          },
        });
      });
      wrap.appendChild(input);
      wrap.appendChild(browse);
      return { el: wrap, refresh };
    }
    return { el: input, refresh };
  }


  const ASSET_ID_PROPS = {
    MeshId: "meshes",
    TextureID: "images",
    TextureId: "images",
    Texture: "images",
    ColorMap: "images",
    NormalMap: "images",
    MetalnessMap: "images",
    RoughnessMap: "images",

    HeightMap: "images",
    DetailColorMap: "images",
    DetailNormalMap: "images",
  };

  function numberEditor(d) {
    const range = NUMBER_RANGE[d.name] || { min: -Infinity, max: Infinity, step: 1 };
    const wrap = el("div", "rsw-ed rsw-num");
    const scrub = el("span", "rsw-num__scrub");
    scrub.title = "Arraste para alterar";
    const dec = document.createElement("button"); dec.type = "button"; dec.className = "rsw-num__btn"; dec.textContent = "\u2212";
    const inc = document.createElement("button"); inc.type = "button"; inc.className = "rsw-num__btn"; inc.textContent = "+";
    const input = document.createElement("input"); input.type = "text"; input.className = "rsw-num__input";
    wrap.append(scrub, dec, input, inc);
    let editing = false;
    if (d.readOnly) {
      input.disabled = true; dec.disabled = true; inc.disabled = true;
      wrap.classList.add("is-readonly");
    } else {
      input.addEventListener("focus", () => { editing = true; markFocus(wrap, true); });
      input.addEventListener("blur", () => { editing = false; markFocus(wrap, false); commitText(); });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
      dec.addEventListener("click", () => stepBy(-range.step));
      inc.addEventListener("click", () => stepBy(range.step));
      wireScrub();
    }
    function applyClamped(n) {
      const fallback = current.length ? current[0].getProperty(d.name) : 0;
      applyValue(d.name, clampNumber(n, range.min, range.max, fallback));
    }
    function commitText() {
      const n = parseFloat(input.value);
      if (Number.isFinite(n)) applyClamped(n);
      else refresh();                                       
    }
    function stepBy(by) {
      const r = readValue(d);
      const base = isFiniteNumber(r.value) ? r.value : 0;
      applyClamped(base + by);
    }
    function wireScrub() {
      let dragging = false, lastX = 0, baseVal = 0, lastEmit = 0;
      scrub.addEventListener("pointerdown", (e) => {
        dragging = true; lastX = e.clientX || 0;
        const r = readValue(d); baseVal = isFiniteNumber(r.value) ? r.value : 0;
        if (scrub.setPointerCapture && e.pointerId != null) scrub.setPointerCapture(e.pointerId);
        if (e.preventDefault) e.preventDefault();
      });
      scrub.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const x = e.clientX || 0; const dx = x - lastX; lastX = x;
        baseVal += dx * range.step;
        const now = Date.now();
        if (now - lastEmit >= 30) { lastEmit = now; applyClamped(baseVal); }            
      });
      const end = (e) => {
        if (!dragging) return; dragging = false; applyClamped(baseVal);
        if (scrub.releasePointerCapture && e && e.pointerId != null) scrub.releasePointerCapture(e.pointerId);
      };
      scrub.addEventListener("pointerup", end);
      scrub.addEventListener("pointercancel", end);
    }
    function refresh() {
      if (editing) return;
      const r = readValue(d);
      if (r.mixed) { input.value = ""; input.placeholder = "\u2014"; }
      else { input.value = fmtNum(r.value); input.placeholder = ""; }
    }
    return { el: wrap, refresh };
  }

  function booleanEditor(d) {
    const wrap = el("label", "rsw-ed rsw-bool");
    const box = document.createElement("input");
    box.type = "checkbox"; box.className = "rsw-bool__box";
    wrap.appendChild(box);
    if (d.readOnly) { box.disabled = true; wrap.classList.add("is-readonly"); }
    else if (d.allowNull) {


      box.addEventListener("click", (e) => {
        e.preventDefault();
        const r = readValue(d);
        let next;
        if (r.mixed || r.value === null || r.value === undefined) {
          next = true;                                      
        } else if (r.value === true) {
          next = false;                                   
        } else {
          next = null;                          
        }
        applyValue(d.name, next);
        refresh();
      });
      box.addEventListener("focus", () => markFocus(wrap, true));
      box.addEventListener("blur", () => markFocus(wrap, false));
    } else {
      box.addEventListener("change", () => applyValue(d.name, !!box.checked));
      box.addEventListener("focus", () => markFocus(wrap, true));
      box.addEventListener("blur", () => markFocus(wrap, false));
    }
    function refresh() {
      const r = readValue(d);
      if (r.mixed) {
        box.indeterminate = true; box.checked = false;
        wrap.classList.remove("is-auto"); box.title = "";
      } else if (d.allowNull && (r.value === null || r.value === undefined)) {

        box.indeterminate = true; box.checked = false;
        wrap.classList.add("is-auto");
        box.title = "AUTO — ativado pelo perfil de GPU (clique para definir explicitamente)";
      } else {
        box.indeterminate = false; box.checked = !!r.value;
        wrap.classList.remove("is-auto"); box.title = "";
      }
    }
    return { el: wrap, refresh };
  }

  function enumEditor(d) {
    const sel = document.createElement("select");
    sel.className = "rsw-ed rsw-enum";
    const mixedOpt = document.createElement("option");
    mixedOpt.value = "__mixed__"; mixedOpt.textContent = "\u2014"; mixedOpt.disabled = true;
    sel.appendChild(mixedOpt);
    const hiddenOpts = d.hiddenOptions || null;
    for (const o of d.options || []) {
      const op = document.createElement("option");
      op.value = o; op.textContent = o;                          


      if (hiddenOpts && hiddenOpts.indexOf(o) !== -1) op.hidden = true;
      sel.appendChild(op);
    }
    if (d.readOnly) { sel.disabled = true; sel.classList.add("is-readonly"); }
    else {
      sel.addEventListener("change", () => {
        if (sel.value === "__mixed__") return;
        applyValue(d.name, sel.value);
      });
      sel.addEventListener("focus", () => markFocus(sel, true));
      sel.addEventListener("blur", () => markFocus(sel, false));
    }
    function refresh() {
      const r = readValue(d);
      sel.value = r.mixed ? "__mixed__" : r.value;
    }
    return { el: sel, refresh };
  }

  function vector3Editor(d) {
    const wrap = el("div", "rsw-ed rsw-vec3");
    const inputs = {};
    let editing = false;
    for (const ax of ["x", "y", "z"]) {
      const field = el("div", "rsw-vec3__field");
      const lab = el("span", "rsw-vec3__axis"); lab.textContent = ax.toUpperCase();
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "rsw-vec3__input";
      if (d.readOnly) { inp.disabled = true; wrap.classList.add("is-readonly"); }
      else {
        inp.addEventListener("focus", () => { editing = true; markFocus(wrap, true); });
        inp.addEventListener("blur", () => { editing = false; markFocus(wrap, false); commit(); });
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      }
      inputs[ax] = inp;
      field.append(lab, inp);
      wrap.appendChild(field);
    }
    function commit() {
      if (d.readOnly) return;
      const r = readValue(d);
      const base = r.value && !r.mixed ? r.value : makeVector3(0, 0, 0);
      const x = parseFloat(inputs.x.value), y = parseFloat(inputs.y.value), z = parseFloat(inputs.z.value);
      applyValue(d.name, makeVector3(
        Number.isFinite(x) ? x : base.x,
        Number.isFinite(y) ? y : base.y,
        Number.isFinite(z) ? z : base.z,
      ));
    }
    function refresh() {
      if (editing) return;
      const r = readValue(d);
      if (r.mixed || !r.value) {
        for (const ax of ["x", "y", "z"]) { inputs[ax].value = ""; inputs[ax].placeholder = "\u2014"; }
      } else {
        for (const ax of ["x", "y", "z"]) { inputs[ax].value = fmtNum(r.value[ax]); inputs[ax].placeholder = ""; }
      }
    }
    return { el: wrap, refresh };
  }

  function colorEditor(d) {
    const wrap = el("div", "rsw-ed rsw-color");
    const sw = document.createElement("button"); sw.type = "button"; sw.className = "rsw-color__swatch";
    const hex = document.createElement("input"); hex.type = "text"; hex.className = "rsw-color__hex";
    wrap.append(sw, hex);
    let popover = null, editing = false;
    if (d.readOnly) { sw.disabled = true; hex.disabled = true; wrap.classList.add("is-readonly"); }
    else {
      hex.addEventListener("focus", () => { editing = true; markFocus(wrap, true); });
      hex.addEventListener("blur", () => { editing = false; markFocus(wrap, false); commitHex(); });
      hex.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); hex.blur(); } });
      sw.addEventListener("click", togglePopover);
    }
    function commitHex() {
      const c = hexToColor(hex.value);
      if (c) applyValue(d.name, c); else refresh();
    }





    const outsideClickListeners = createListenerScope("propertiesColorPopover");
    function togglePopover() {
      if (popover) { closePopover(); return; }
      popover = buildColorPopover(d, applyValue, () => readValue(d));
      wrap.appendChild(popover);


      setTimeout(() => {
        if (!popover) return;                                             
        outsideClickListeners.add(document, "click", outside);
      }, 0);
    }
    function closePopover() {
      if (!popover) return;
      popover.remove(); popover = null;
      outsideClickListeners.disposeAll();
    }
    function outside(e) {
      const t = e && e.target;
      if (t && typeof wrap.contains === "function" && wrap.contains(t)) return;
      closePopover();
    }
    function refresh() {
      const r = readValue(d);
      if (r.mixed || !r.value) {
        sw.style.background = "transparent"; sw.textContent = "\u2014";
        if (!editing) { hex.value = ""; hex.placeholder = "\u2014"; }
      } else {
        sw.textContent = ""; sw.style.background = colorToCss(r.value);
        if (!editing) { hex.value = colorToHex(r.value); hex.placeholder = ""; }
      }
      if (popover && popover._refresh) popover._refresh();
    }
    return { el: wrap, refresh, _close: closePopover };
  }

  function instanceEditor(d) {
    const span = el("div", "rsw-ed rsw-ed__ref is-readonly");
    function refresh() {
      const r = readValue(d);
      if (r.mixed) span.textContent = "\u2014";
      else span.textContent = r.value && r.value.name ? r.value.name : "(none)";
    }
    return { el: span, refresh };
  }

  function buildColorPopover(d, apply, getR) {
    const pop = el("div", "rsw-cpop");
    if (pop.addEventListener) pop.addEventListener("click", (e) => e.stopPropagation && e.stopPropagation());
    const rgbWrap = el("div", "rsw-cpop__rgb");
    const inputs = {};
    for (const ch of ["r", "g", "b"]) {
      const f = el("label", "rsw-cpop__chan");
      const lab = el("span"); lab.textContent = ch.toUpperCase();
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "rsw-cpop__num";
      inputs[ch] = inp;
      inp.addEventListener("change", commitRGB);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commitRGB(); } });
      f.append(lab, inp); rgbWrap.appendChild(f);
    }
    const hexRow = el("label", "rsw-cpop__hexrow");
    const hexLab = el("span"); hexLab.textContent = "Hex";
    const hex = document.createElement("input"); hex.type = "text"; hex.className = "rsw-cpop__hex";
    hex.addEventListener("change", commitHex);
    hex.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commitHex(); } });
    hexRow.append(hexLab, hex);
    const palTitle = el("div", "rsw-cpop__ptitle"); palTitle.textContent = "BrickColor clássico";
    const pal = el("div", "rsw-cpop__palette");
    for (const [name, hx] of CLASSIC_COLORS) {
      const s = document.createElement("button"); s.type = "button"; s.className = "rsw-cpop__swatch";
      s.style.background = hx; s.title = name;
      s.addEventListener("click", () => { const c = hexToColor(hx); if (c) apply(d.name, c); });
      pal.appendChild(s);
    }
    function clampByte(v) { return clampNumber(parseInt(v, 10), 0, 255, 0); }
    function commitRGB() {
      apply(d.name, makeColor(clampByte(inputs.r.value) / 255, clampByte(inputs.g.value) / 255, clampByte(inputs.b.value) / 255));
    }
    function commitHex() { const c = hexToColor(hex.value); if (c) apply(d.name, c); }
    pop._refresh = function () {
      const r = getR();
      if (r.mixed || !r.value) { inputs.r.value = ""; inputs.g.value = ""; inputs.b.value = ""; hex.value = ""; }
      else {
        inputs.r.value = String(Math.round(clamp01(r.value.r) * 255));
        inputs.g.value = String(Math.round(clamp01(r.value.g) * 255));
        inputs.b.value = String(Math.round(clamp01(r.value.b) * 255));
        hex.value = colorToHex(r.value);
      }
    };
    pop._refresh();
    pop.append(rgbWrap, hexRow, palTitle, pal);
    return pop;
  }


  function multiFieldEditor(d, fields, build) {
    const wrap = el("div", "rsw-ed rsw-vec3 rsw-multi");
    const inputs = {};
    let editing = false;
    for (const [key, lbl] of fields) {
      const field = el("div", "rsw-vec3__field");
      const lab = el("span", "rsw-vec3__axis"); lab.textContent = lbl;
      const inp = document.createElement("input"); inp.type = "text"; inp.className = "rsw-vec3__input";
      if (d.readOnly) { inp.disabled = true; wrap.classList.add("is-readonly"); }
      else {
        inp.addEventListener("focus", () => { editing = true; markFocus(wrap, true); });
        inp.addEventListener("blur", () => { editing = false; markFocus(wrap, false); commit(); });
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
      }
      inputs[key] = inp;
      field.append(lab, inp);
      wrap.appendChild(field);
    }
    function commit() {
      if (d.readOnly) return;
      const r = readValue(d);
      const base = r.value && !r.mixed ? r.value : null;
      const get = (k) => {
        const v = parseFloat(inputs[k].value);
        if (Number.isFinite(v)) return v;
        return base && isFiniteNumber(base[k]) ? base[k] : 0;
      };
      applyValue(d.name, build(get));
    }
    function refresh() {
      if (editing) return;
      const r = readValue(d);
      const keys = fields.map((f) => f[0]);
      if (r.mixed || !r.value) {
        for (const k of keys) { inputs[k].value = ""; inputs[k].placeholder = "\u2014"; }
      } else {
        for (const k of keys) { inputs[k].value = fmtNum(r.value[k]); inputs[k].placeholder = ""; }
      }
    }
    return { el: wrap, refresh };
  }

  function udim2Editor(d) {
    return multiFieldEditor(
      d,
      [["xScale", "X Scale"], ["xOffset", "X Offset"], ["yScale", "Y Scale"], ["yOffset", "Y Offset"]],
      (g) => makeUDim2(g("xScale"), g("xOffset"), g("yScale"), g("yOffset")),
    );
  }
  function udimEditor(d) {
    return multiFieldEditor(d, [["scale", "Scale"], ["offset", "Offset"]], (g) => makeUDim(g("scale"), g("offset")));
  }
  function vector2Editor(d) {
    return multiFieldEditor(d, [["x", "X"], ["y", "Y"]], (g) => makeVector2(g("x"), g("y")));
  }
  function rectEditor(d) {
    return multiFieldEditor(
      d,
      [["minX", "Min X"], ["minY", "Min Y"], ["maxX", "Max X"], ["maxY", "Max Y"]],
      (g) => makeRect(g("minX"), g("minY"), g("maxX"), g("maxY")),
    );
  }



  function colorSequenceEditor(d) {
    const wrap = el("div", "rsw-ed rsw-cseq");
    wrap.style.cssText = "display:flex;align-items:center;min-width:0;";
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 18;
    canvas.style.cssText = "flex:1;min-width:0;height:18px;border-radius:3px;cursor:pointer;";
    wrap.appendChild(canvas);
    if (d.readOnly) {
      wrap.classList.add("is-readonly");
      canvas.style.cursor = "default";
    } else {
      canvas.addEventListener("click", () => {
        openColorSequenceEditor({
          anchor: canvas,
          title: d.name,
          getValue: () => readValue(d).value,
          setValue: (v) => applyValue(d.name, v),
          onClose: () => refresh(),
        });
      });
    }
    function refresh() {
      const r = readValue(d);
      const ok = !r.mixed && r.value && Array.isArray(r.value.keypoints) && r.value.keypoints.length >= 2;
      drawColorSequencePreview(canvas, ok ? r.value : null);
    }
    return { el: wrap, refresh };
  }


  function numberSequenceEditor(d) {
    const wrap = el("div", "rsw-ed rsw-nseq");
    wrap.style.cssText = "display:flex;align-items:center;min-width:0;";
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 20;
    canvas.style.cssText = "flex:1;min-width:0;height:20px;border-radius:3px;cursor:pointer;";
    wrap.appendChild(canvas);
    if (d.readOnly) {
      wrap.classList.add("is-readonly");
      canvas.style.cursor = "default";
    } else {
      canvas.addEventListener("click", () => {
        openNumberSequenceEditor({
          anchor: canvas,
          title: d.name,
          getValue: () => readValue(d).value,
          setValue: (v) => applyValue(d.name, v),
          onClose: () => refresh(),
        });
      });
    }
    function refresh() {
      const r = readValue(d);
      const ok = !r.mixed && r.value && Array.isArray(r.value.keypoints) && r.value.keypoints.length >= 2;
      drawNumberSequencePreview(canvas, ok ? r.value : null);
    }
    return { el: wrap, refresh };
  }


  function numberRangeEditor(d) {
    return multiFieldEditor(d, [["min", "Min"], ["max", "Max"]], (g) => {
      const mn = parseFloat(g("min"));
      const mx = parseFloat(g("max"));
      return { min: Number.isFinite(mn) ? mn : 0, max: Number.isFinite(mx) ? mx : 0 };
    });
  }


  function tableEditor(d) {
    const wrap = el("div", "rsw-ed rsw-ed__table");
    let editing = false;
    function currentObj() {
      const r = readValue(d);
      if (r.mixed || r.empty || !r.value || typeof r.value !== "object") return {};
      return { ...r.value };
    }
    function commit(obj) {
      const out = {};
      for (const k of Object.keys(obj)) {
        const key = String(k).trim();
        if (!key) continue;
        out[key] = obj[k];
      }
      applyValue(d.name, out);
    }
    function parseCost(raw) {
      const s = String(raw).trim().toLowerCase();
      if (s === "inf" || s === "math.huge" || s === "infinity") return Infinity;
      const f = parseFloat(s);
      return Number.isFinite(f) ? f : 0;
    }
    function collect() {
      const next = {};
      for (const rr of wrap.querySelectorAll(".rsw-ed__trow")) {
        const kk = rr.querySelector(".rsw-ed__tkey").value.trim();
        if (!kk) continue;
        next[kk] = parseCost(rr.querySelector(".rsw-ed__tval").value);
      }
      return next;
    }
    function buildRows(obj) {

      wrap.replaceChildren();
      for (const k of Object.keys(obj)) {
        const row = el("div", "rsw-ed__trow");
        const keyInp = document.createElement("input");
        keyInp.type = "text"; keyInp.className = "rsw-ed__tkey"; keyInp.value = k;
        keyInp.placeholder = "Label";
        const valInp = document.createElement("input");
        valInp.type = "text"; valInp.className = "rsw-ed__tval";
        valInp.value = obj[k] === Infinity ? "inf" : String(obj[k]);
        const del = document.createElement("button");
        del.type = "button"; del.className = "rsw-ed__tdel"; del.textContent = "\u00d7"; del.title = "Remover";
        if (d.readOnly) { keyInp.disabled = true; valInp.disabled = true; del.disabled = true; }
        else {
          const onFocus = () => { editing = true; };
          const onBlur = () => { editing = false; commit(collect()); };
          const onKey = (inp) => (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } };
          keyInp.addEventListener("focus", onFocus);
          keyInp.addEventListener("blur", onBlur);
          keyInp.addEventListener("keydown", onKey(keyInp));
          valInp.addEventListener("focus", onFocus);
          valInp.addEventListener("blur", onBlur);
          valInp.addEventListener("keydown", onKey(valInp));
          del.addEventListener("click", () => { const o = currentObj(); delete o[k]; commit(o); refresh(); });
        }
        row.append(keyInp, valInp, del);
        wrap.appendChild(row);
      }
      if (!d.readOnly) {
        const addBtn = document.createElement("button");
        addBtn.type = "button"; addBtn.className = "rsw-ed__tadd"; addBtn.textContent = "+ Adicionar";
        addBtn.addEventListener("click", () => {
          const o = currentObj();
          let base = "Label", n = 1, name = base;
          while (Object.prototype.hasOwnProperty.call(o, name)) { name = base + n; n++; }
          o[name] = 0;
          commit(o); refresh();
        });
        wrap.appendChild(addBtn);
      }
    }
    function refresh() {
      if (editing) return;
      buildRows(currentObj());
    }
    return { el: wrap, refresh };
  }

  function makeEditor(d) {
    switch (d.type) {
      case PropTypes.String: return stringEditor(d);
      case PropTypes.Table: return tableEditor(d);
      case PropTypes.Number: return numberEditor(d);
      case PropTypes.Boolean: return booleanEditor(d);
      case PropTypes.Color: return colorEditor(d);
      case PropTypes.Vector3: return vector3Editor(d);
      case PropTypes.Enum: return enumEditor(d);
      case PropTypes.Instance: return instanceEditor(d);
      case PropTypes.UDim2: return udim2Editor(d);
      case PropTypes.UDim: return udimEditor(d);
      case PropTypes.Vector2: return vector2Editor(d);
      case PropTypes.Rect: return rectEditor(d);
      case PropTypes.ColorSequence: return colorSequenceEditor(d);
      case PropTypes.NumberSequence: return numberSequenceEditor(d);
      case PropTypes.NumberRange: return numberRangeEditor(d);
      default: return instanceEditor(d);
    }
  }


  function computeCommon(items) {
    if (items.length === 0) return [];
    const result = [];

    for (const s of SYNTHETIC) result.push(s);
    const base = getResolvedProperties(items[0].className);
    for (const d of base) {
      if (d.name === "Contents" && items[0].className === "LocalizationTable") continue;
      let okAll = true;
      for (const it of items) {
        const rp = getResolvedProperties(it.className).find((x) => x.name === d.name);
        if (!rp || rp.type !== d.type) { okAll = false; break; }
      }
      if (okAll) result.push(d);
    }
    return result;
  }

  function groupByCategory(common) {
    const groups = new Map();
    for (const d of common) {
      const cat = PROP_CATEGORY[d.name] || "Data";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(d);
    }
    const cats = [...groups.keys()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
      const ra = ia < 0 ? 999 : ia, rb = ib < 0 ? 999 : ib;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
    return cats.map((c) => [c, groups.get(c)]);
  }


  function renderHeader() {
    header.replaceChildren();
    if (current.length === 0) {
      const t = el("span", "rsw-props__empty"); t.textContent = "Nada selecionado";
      header.appendChild(t); return;
    }
    if (current.length === 1) {
      const it = current[0];
      const icon = createIcon(iconNameFor(it.className), 16); icon.classList.add("rsw-props__hicon");
      const name = el("span", "rsw-props__name"); name.textContent = it.name;
      const cls = el("span", "rsw-props__class"); cls.textContent = ` (${it.className})`;
      header.append(icon, name, cls);


      if (it.className === "Sound") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rsw-props__soundpreview";
        btn.style.cssText = "margin-left:auto;cursor:pointer;background:#2c313c;color:#dfe3ea;border:1px solid #3c4250;border-radius:4px;padding:2px 8px;font-size:11px;white-space:nowrap;";
        btn.replaceChildren(
          createIcon(isAudioPreviewActive() ? "stop" : "play", 10),
          document.createTextNode(isAudioPreviewActive() ? " Stop" : " Preview Sound"),
        );
        btn.title = "Toca o áudio no editor em volume reduzido (Parte 28).";
        btn.addEventListener("click", () => {
          if (isAudioPreviewActive()) stopAudioPreview();
          else previewSoundInstance(it);
        });
        header.append(btn);
      }
    } else {
      const allSame = current.every((i) => i.className === current[0].className);
      const icon = createIcon(allSame ? iconNameFor(current[0].className) : "instance", 16);
      icon.classList.add("rsw-props__hicon");
      const name = el("span", "rsw-props__name"); name.textContent = `${current.length} objects`;
      header.append(icon, name);
      if (allSame) {
        const cls = el("span", "rsw-props__class"); cls.textContent = ` (${current[0].className})`;
        header.append(cls);
      }
    }
  }


  function setCatCollapsed(rec, c) {
    rec.rowsWrap.hidden = c;
    rec.arrow.classList.toggle("rsw-cat__arrow--open", !c);
    rec.head.classList.toggle("is-collapsed", c);
  }
  function buildCatRows(rec) {
    if (rec.built) return;
    rec.built = true;
    for (const d of rec.props) {
      const row = el("div", "rsw-row2");
      if (d.readOnly) row.classList.add("is-readonly");
      const nameEl = el("div", "rsw-row2__name"); nameEl.textContent = d.name;            
      const desc = PROP_DESC[d.name]; if (desc) nameEl.title = desc;
      const ctrl = makeEditor(d);
      editors.set(d.name, ctrl);
      const valEl = el("div", "rsw-row2__val"); valEl.appendChild(ctrl.el);
      row.append(nameEl, valEl);
      rec.rowsWrap.appendChild(row);
      ctrl.refresh();
    }
  }
  function refreshCat(rec) {
    for (const d of rec.props) { const c = editors.get(d.name); if (c) c.refresh(); }
  }
  function toggleCat(cat) {
    const rec = sections.get(cat); if (!rec) return;
    const willCollapse = !collapsed.has(cat);
    if (willCollapse) collapsed.add(cat); else collapsed.delete(cat);
    setCatCollapsed(rec, willCollapse);
    if (!willCollapse) { buildCatRows(rec); refreshCat(rec); }
  }


  function closeOpenPopovers(controllers) {
    for (const controller of controllers.values()) {
      if (controller && typeof controller._close === "function") controller._close();
    }
  }

  function buildStructure(common) {
    closeOpenPopovers(editors);
    editors.clear();
    sections.clear();
    bodyEl.replaceChildren();
    if (common.length === 0) {
      const m = el("div", "rsw-props__empty");
      m.textContent = current.length ? "Sem propriedades em comum" : "Selecione um objeto para ver as propriedades";
      bodyEl.appendChild(m);
      return;
    }
    for (const [cat, props] of groupByCategory(common)) {
      const sec = el("div", "rsw-cat");
      const head = el("div", "rsw-cat__head");
      const arrow = el("span", "rsw-cat__arrow");
      const title = el("span", "rsw-cat__title"); title.textContent = cat;
      head.append(arrow, title);
      const rowsWrap = el("div", "rsw-cat__rows");
      sec.append(head, rowsWrap);
      bodyEl.appendChild(sec);
      const rec = { head, rowsWrap, props, built: false, arrow };
      sections.set(cat, rec);
      head.addEventListener("click", () => toggleCat(cat));
      const collapsedNow = collapsed.has(cat);
      setCatCollapsed(rec, collapsedNow);
      if (!collapsedNow) buildCatRows(rec);                                          
    }
  }

  function refreshAll() {
    for (const rec of sections.values()) {
      if (rec.built && !rec.rowsWrap.hidden) refreshCat(rec);
    }
  }

  function liveSelection() {
    return selection.get().filter((i) => i && typeof i.isDestroyed === "function" && !i.isDestroyed());
  }

  function rebuild() {
    current = liveSelection();
    renderHeader();
    const common = computeCommon(current);
    const sig = common.map((d) => `${d.name}:${d.type}${d.readOnly ? ":ro" : ""}`).join("|");
    if (sig === signature && current.length > 0) {
      refreshAll();                                        



      renderAttributes();
      renderClimateActions();
      return;
    }
    signature = sig;
    buildStructure(common);
    refreshAll();
    renderAttributes();
    renderClimateActions();
  }


  function renderClimateActions() {
    const targets = aliveTargets();
    if (targets.length !== 1 || targets[0].className !== "ClimateService") return;
    const svc = targets[0];
    const rootOf = () => {
      let n = svc;
      let guard = 0;
      while (n && typeof n.getParent === "function" && n.getParent() && guard < 100) { n = n.getParent(); guard += 1; }
      return n;
    };
    const row = el("div", "rsw-climate-actions");
    const mkBtn = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "rsw-attrs__add";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", () => { try { fn(); } catch (_) {          } });
      row.appendChild(b);
    };
    mkBtn("Preview Weather", "Aplica o clima configurado com transicao curta para teste.", () => {
      climSetWeather(rootOf(), svc.getProperty("WeatherType"), svc.getProperty("Intensity"), 0.5);
    });
    mkBtn("Reset to Clear", "Retorna o clima para Clear.", () => { climStopWeather(rootOf()); });
    attrBody.appendChild(row);
  }


  function aliveTargets() {
    return current.filter((it) => it && typeof it.isDestroyed === "function" && !it.isDestroyed());
  }

  function commonAttributes() {
    const targets = aliveTargets();
    if (targets.length === 0) return [];
    const first = targets[0].getAttributesList();                       
    const out = [];
    for (const a of first) {
      let okAll = true;
      for (let i = 1; i < targets.length; i++) {
        if (targets[i].getAttributeType(a.name) !== a.type) { okAll = false; break; }
      }
      if (okAll) out.push({ name: a.name, attrType: a.type });
    }
    out.sort((x, y) => x.name.localeCompare(y.name));
    return out;
  }

  function attrDescriptor(name, attrType) {
    const d = { name, attribute: true, attrType, type: attributeTypeToPropType(attrType), readOnly: false, options: null };
    if (attrType === "BrickColor") { d.type = PropTypes.Enum; d.options = Enums.BrickColorName; }
    else if (attrType === "Font") { d.type = PropTypes.Enum; d.options = Enums.Font; }
    return d;
  }

  function applyAttributeValue(d, value) {
    const targets = aliveTargets();
    if (targets.length === 0) return;
    const before = targets.map((it) => ({
      it, had: it.hasAttribute(d.name), type: it.getAttributeType(d.name),
      val: it.hasAttribute(d.name) ? it.getAttribute(d.name) : null,
    }));
    commands.execute({
      name: "Set Attribute",
      do() {
        for (const it of targets) {
          const r = it.setAttribute(d.name, d.attrType, value);
          if (r && r.ok === false) logger.warn(`Attribute "${d.name}": ${r.error}`);
        }
      },
      undo() {
        for (const b of before) {
          if (b.it.isDestroyed && b.it.isDestroyed()) continue;
          if (b.had) b.it.setAttribute(d.name, b.type, b.val);
          else b.it.removeAttribute(d.name);
        }
      },
    });
  }

  function addAttributeCommand(name, attrType, value) {
    const targets = aliveTargets();
    if (targets.length === 0) return;
    commands.execute({
      name: "Add Attribute",
      do() {
        for (const it of targets) {
          const r = it.setAttribute(name, attrType, value);
          if (r && r.ok === false) logger.warn(`Attribute "${name}": ${r.error}`);
        }
      },
      undo() {
        for (const it of targets) { if (!(it.isDestroyed && it.isDestroyed())) it.removeAttribute(name); }
      },
    });
    renderAttributes();
    renderClimateActions();                                                                       
  }

  function removeAttributeCommand(name) {
    const targets = aliveTargets();
    const before = targets.map((it) => ({
      it, had: it.hasAttribute(name), type: it.getAttributeType(name),
      val: it.hasAttribute(name) ? it.getAttribute(name) : null,
    }));
    commands.execute({
      name: "Remove Attribute",
      do() { for (const it of targets) it.removeAttribute(name); },
      undo() {
        for (const b of before) {
          if (b.it.isDestroyed && b.it.isDestroyed()) continue;
          if (b.had) b.it.setAttribute(name, b.type, b.val);
        }
      },
    });
    renderAttributes();
    renderClimateActions();
  }

  function renameAttributeCommand(oldName, newName) {
    const targets = aliveTargets();
    const recs = targets.map((it) => ({
      it, type: it.getAttributeType(oldName), had: it.hasAttribute(oldName),
      val: it.hasAttribute(oldName) ? it.getAttribute(oldName) : null,
    }));
    commands.execute({
      name: "Rename Attribute",
      do() {
        for (const r of recs) {
          if (!r.had) continue;
          r.it.setAttribute(newName, r.type, r.val);
          r.it.removeAttribute(oldName);
        }
      },
      undo() {
        for (const r of recs) {
          if (!r.had) continue;
          r.it.setAttribute(oldName, r.type, r.val);
          r.it.removeAttribute(newName);
        }
      },
    });
    renderAttributes();
    renderClimateActions();
  }

  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(text));
    } catch (_) {            }
  }

  function promptRename(oldName) {
    openPrompt({
      title: "Rename Attribute", label: "Novo nome", value: oldName, maxLength: 100,
      validate: (val) => {
        const v = validateAttributeName(val);
        if (!v.ok) return v.error;
        if (val !== oldName && aliveTargets().some((it) => it.hasAttribute(val))) return "Já existe um atributo com esse nome.";
        return null;
      },
    }).then((val) => { if (val && val !== oldName) renameAttributeCommand(oldName, val); });
  }

  function openAddAttributeDialog() {
    const targets = aliveTargets();
    if (targets.length === 0) return;
    const wrap = el("div", "rsw-form rsw-attr-add");
    const nameLab = el("label", "rsw-field__label"); nameLab.textContent = "Name";
    const nameInput = document.createElement("input");
    nameInput.type = "text"; nameInput.className = "rsw-input"; nameInput.maxLength = 100;
    nameInput.setAttribute("spellcheck", "false");
    const typeLab = el("label", "rsw-field__label"); typeLab.textContent = "Type";
    const typeSel = document.createElement("select"); typeSel.className = "rsw-input";
    for (const t of ATTRIBUTE_TYPES) {
      const o = document.createElement("option"); o.value = t; o.textContent = ATTRIBUTE_TYPE_LABELS[t] || t;
      typeSel.appendChild(o);
    }
    const valLab = el("label", "rsw-field__label"); valLab.textContent = "Initial value";
    const valHolder = el("div", "rsw-attr-add__val");
    const err = el("p", "rsw-field__error"); err.hidden = true;
    wrap.append(nameLab, nameInput, typeLab, typeSel, valLab, valHolder, err);

    let initialValue = defaultAttributeValue(typeSel.value);
    function buildValInput() {
      valHolder.replaceChildren();
      const t = typeSel.value;
      initialValue = defaultAttributeValue(t);
      if (t === "string" || t === "BrickColor" || t === "Font") {
        const i = document.createElement("input"); i.type = "text"; i.className = "rsw-input";
        i.value = t === "string" ? "" : String(initialValue);
        i.addEventListener("input", () => { initialValue = i.value; });
        valHolder.appendChild(i);
      } else if (t === "number") {
        const i = document.createElement("input"); i.type = "number"; i.className = "rsw-input"; i.value = "0";
        i.addEventListener("input", () => { const n = parseFloat(i.value); initialValue = Number.isFinite(n) ? n : 0; });
        valHolder.appendChild(i);
      } else if (t === "boolean") {
        const i = document.createElement("input"); i.type = "checkbox";
        i.addEventListener("change", () => { initialValue = i.checked; });
        valHolder.appendChild(i);
      } else {
        const note = el("span", "rsw-attr-add__note");
        note.textContent = "Valor padrão (edite no painel após criar).";
        valHolder.appendChild(note);
      }
    }
    typeSel.addEventListener("change", buildValInput);
    buildValInput();

    let h = null;
    function submit() {
      const name = nameInput.value.trim();
      const v = validateAttributeName(name);
      if (!v.ok) { err.textContent = v.error; err.hidden = false; return; }
      if (targets.some((it) => it.hasAttribute(name))) { err.textContent = "Já existe um atributo com esse nome."; err.hidden = false; return; }
      const t = typeSel.value;
      const c = coerceAttributeValue(t, initialValue);
      if (!c.ok) { err.textContent = c.error; err.hidden = false; return; }
      addAttributeCommand(name, t, c.value);
      if (h) h.close({ reason: "ok" });
    }
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    const foot = el("div", "rsw-modal__btnrow");
    foot.appendChild(makeButton("Cancel", "ghost", () => h && h.close({ reason: "cancel" })));
    foot.appendChild(makeButton("Add", "primary", submit));
    h = openModal({ title: "Add Attribute", body: wrap, footer: foot, width: 380 });
  }

  function renderAttributes() {
    closeOpenPopovers(attrEditors);
    attrEditors.clear();
    attrDescriptors.clear();
    attrBody.replaceChildren();
    if (aliveTargets().length === 0) { attrBody.hidden = true; return; }
    attrBody.hidden = false;

    const sec = el("div", "rsw-cat rsw-attrs");
    const head = el("div", "rsw-cat__head");
    const arrow = el("span", "rsw-cat__arrow");
    if (!attrCollapsed) arrow.classList.add("rsw-cat__arrow--open");
    const title = el("span", "rsw-cat__title"); title.textContent = "Attributes";
    const addBtn = document.createElement("button");
    addBtn.type = "button"; addBtn.className = "rsw-attrs__add"; addBtn.textContent = "+ Add Attribute";
    addBtn.title = "Adicionar um novo atributo";
    addBtn.addEventListener("click", (e) => { e.stopPropagation(); openAddAttributeDialog(); });
    head.append(arrow, title, addBtn);
    const rows = el("div", "rsw-cat__rows");
    if (attrCollapsed) rows.hidden = true;
    head.addEventListener("click", () => {
      attrCollapsed = !attrCollapsed;
      rows.hidden = attrCollapsed;
      arrow.classList.toggle("rsw-cat__arrow--open", !attrCollapsed);
    });
    sec.append(head, rows);
    attrBody.appendChild(sec);
    if (attrCollapsed) return;                                                      

    const list = commonAttributes();
    if (list.length === 0) {
      const empty = el("div", "rsw-attrs__empty");
      empty.textContent = current.length > 1 ? "Nenhum atributo em comum." : "Nenhum atributo. Use \"+ Add Attribute\".";
      rows.appendChild(empty);
      return;
    }
    for (const a of list) {
      const d = attrDescriptor(a.name, a.attrType);
      attrDescriptors.set(a.name, d);
      const row = el("div", "rsw-row2");
      const nameEl = el("div", "rsw-row2__name"); nameEl.textContent = a.name;              
      nameEl.title = ATTRIBUTE_TYPE_LABELS[a.attrType] || a.attrType;
      const ctrl = makeEditor(d);
      attrEditors.set(a.name, ctrl);
      const valEl = el("div", "rsw-row2__val"); valEl.appendChild(ctrl.el);
      row.append(nameEl, valEl);
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openContextMenu({
          x: e.clientX, y: e.clientY,
          items: [

            { label: "Rename", onSelect: () => promptRename(a.name) },
            { label: "Delete", onSelect: () => removeAttributeCommand(a.name) },
            { label: "Copy Name", onSelect: () => copyText(a.name) },
          ],
        });
      });
      rows.appendChild(row);
      ctrl.refresh();
    }
  }


  bus.on("selection:changed", rebuild);

  bus.on("audio:previewChanged", () => renderHeader());
  bus.on(Events.PropertyChanged, ({ instance, property }) => {
    if (!current.includes(instance)) return;
    if (property === "Name") renderHeader();
    const c = editors.get(property);                                                  
    if (c) c.refresh();
  });


  bus.on(Events.AttributeChanged, ({ instance, name }) => {
    if (!current.includes(instance)) return;
    const removed = typeof instance.hasAttribute === "function" && !instance.hasAttribute(name);
    if (!removed && attrDescriptors.has(name)) {
      const c = attrEditors.get(name);
      if (c) c.refresh();
    } else {


      renderAttributes();
      renderClimateActions();                                                       
    }
  });

  rebuild();
  logger.info("Properties pronto.");

  return { header, bodyEl, editors, sections, collapsed, rebuild, _toggleCat: toggleCat };
}
