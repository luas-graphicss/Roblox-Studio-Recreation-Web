import * as THREE from "three";
import { rectLightNits, surfaceLightFaceRotation } from "./llRectExtrasCore.js";
import { findSourceTexture } from "./llRectSourceTextureCore.js";
import { llQa } from "./llTelemetry.js";
import { areLtcTablesReady, ensureLtcTablesLoaded } from "./ltcTablesLoader.js";


export const LTC_TEXTURE_UNITS = 2;

export const SOURCE_PROXY_TEXTURE_UNITS = 1;

const MIN_RECT_SIDE = 0.05;
const SURFACE_LIGHT_TYPE = "SurfaceLight";

const legacyPointLights = new WeakMap();
const sourceTextureMaps = new Map();
const faceRotation = new THREE.Quaternion();

let ltcUniformsReady = false;


function ensureLtcUniforms() {
  if (ltcUniformsReady) return true;
  if (areLtcTablesReady()) {
    ltcUniformsReady = true;
    llQa.texUnit("ll-f7-ltc", LTC_TEXTURE_UNITS);
    return true;
  }
  ensureLtcTablesLoaded().then((ready) => {
    if (!ready || ltcUniformsReady) return;
    ltcUniformsReady = true;
    llQa.texUnit("ll-f7-ltc", LTC_TEXTURE_UNITS);
  });
  return false;
}

export function isPromotedRectSource(localLight) {
  return !!(localLight && localLight.luz && localLight.luz.isRectAreaLight);
}

function readConfiguredState(light) {
  return { color: light.color.clone(), candela: light.intensity, visible: light.visible };
}

function attachRectAreaLight(localLight) {
  ensureLtcUniforms();
  const legacyLight = localLight.luz;
  const props = localLight.props;
  const rectLight = new THREE.RectAreaLight(
    0xffffff,
    1,
    Math.max(Number(props.Width) || MIN_RECT_SIDE, MIN_RECT_SIDE),
    Math.max(Number(props.Height) || MIN_RECT_SIDE, MIN_RECT_SIDE),
  );
  rectLight.name = legacyLight.name;
  rectLight.position.copy(legacyLight.position);
  rectLight.userData.llTipo = localLight.tipo;
  rectLight.userData.llProps = props;
  rectLight.userData.llRectPromoted = true;
  legacyPointLights.set(localLight, legacyLight);
  localLight.grupo.remove(legacyLight);
  localLight.grupo.add(rectLight);
  localLight.luz = rectLight;
  return rectLight;
}

function restoreLegacyPointLight(localLight) {
  const legacyLight = legacyPointLights.get(localLight);
  if (!legacyLight) return localLight.luz;
  const rectLight = localLight.luz;
  localLight.grupo.remove(rectLight);
  if (typeof rectLight.dispose === "function") rectLight.dispose();
  localLight.grupo.add(legacyLight);
  localLight.luz = legacyLight;
  legacyPointLights.delete(localLight);
  return legacyLight;
}


function aimRectLightAtTarget(rectLight, target) {
  if (!target) {
    rectLight.quaternion.identity();
    return;
  }
  target.updateWorldMatrix(true, false);
  const targetWorldPosition = target.matrixWorld.elements;
  rectLight.lookAt(targetWorldPosition[12], targetWorldPosition[13], targetWorldPosition[14]);
}


function applyRectPose(localLight) {
  const rectLight = localLight.luz;
  aimRectLightAtTarget(rectLight, localLight.alvo);
  if (localLight.tipo === SURFACE_LIGHT_TYPE) {
    const rotation = surfaceLightFaceRotation(localLight.props.Face);
    faceRotation.set(rotation[0], rotation[1], rotation[2], rotation[3]);
    rectLight.quaternion.multiply(faceRotation);
  }
}

function buildSourceTextureMap(texture) {
  const pixelCount = texture.width * texture.height;
  const data = new Uint8Array(pixelCount * 4);
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    data[pixel * 4 + 0] = texture.pixels[pixel * 3 + 0];
    data[pixel * 4 + 1] = texture.pixels[pixel * 3 + 1];
    data[pixel * 4 + 2] = texture.pixels[pixel * 3 + 2];
    data[pixel * 4 + 3] = 255;
  }
  const map = new THREE.DataTexture(data, texture.width, texture.height, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.LinearFilter;
  map.flipY = true;
  map.needsUpdate = true;
  return map;
}

function sourceTextureMap(sourceTextureId) {
  const texture = findSourceTexture(sourceTextureId);
  if (!texture) return null;
  if (!sourceTextureMaps.has(texture.id)) {
    sourceTextureMaps.set(texture.id, buildSourceTextureMap(texture));
    llQa.texUnit("ll-f7-source-proxy", SOURCE_PROXY_TEXTURE_UNITS);
  }
  return sourceTextureMaps.get(texture.id);
}


function applySourceTextureToProxy(localLight, sourceTextureId) {
  const proxy = localLight.proxy;
  if (!proxy || !proxy.material) return null;
  const map = sourceTextureMap(sourceTextureId);
  if (proxy.material.map === map) return map;
  proxy.material.map = map;
  proxy.material.needsUpdate = true;
  return map;
}

export function describeRectSource(localLight) {
  const promoted = isPromotedRectSource(localLight);
  const light = localLight.luz;
  return {
    nome: localLight.nome,
    tipo: localLight.tipo,
    promovida: promoted,
    nits: promoted ? light.intensity : 0,
    width: promoted ? light.width : localLight.props.Width,
    height: promoted ? light.height : localLight.props.Height,


    sombraPerdida: promoted && !!localLight.props.Shadows,
  };
}


export function syncRectSource(localLight, options) {
  const settings = options || {};
  const shouldPromote = !!settings.promote;
  const configured = readConfiguredState(localLight.luz);
  if (shouldPromote && !isPromotedRectSource(localLight)) attachRectAreaLight(localLight);
  else if (!shouldPromote && isPromotedRectSource(localLight)) restoreLegacyPointLight(localLight);

  const props = localLight.props;
  const light = localLight.luz;
  light.color.copy(configured.color);
  light.visible = configured.visible;
  if (isPromotedRectSource(localLight)) {
    light.width = Math.max(Number(props.Width) || MIN_RECT_SIDE, MIN_RECT_SIDE);
    light.height = Math.max(Number(props.Height) || MIN_RECT_SIDE, MIN_RECT_SIDE);
    light.intensity = rectLightNits(configured.candela, light.width, light.height);
    applyRectPose(localLight);
  } else {
    light.intensity = configured.candela;
    light.distance = props.Range;
    light.castShadow = !!props.Shadows;
  }
  applySourceTextureToProxy(localLight, shouldPromote ? props.SourceTexture : "");
  return describeRectSource(localLight);
}


export function collectVisibleRectAreaLightsInRenderOrder(root) {
  const found = [];
  const visit = (object) => {
    if (!object || object.visible === false) return;
    if (object.isRectAreaLight) found.push(object);
    const children = object.children || [];
    for (let index = 0; index < children.length; index++) visit(children[index]);
  };
  visit(root);
  return found;
}

export function ltcTextureUnitsInUse() {
  return ltcUniformsReady ? LTC_TEXTURE_UNITS : 0;
}
