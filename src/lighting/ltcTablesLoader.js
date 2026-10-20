import * as THREE from "three";

import { fetchPublicArrayBuffer } from "../utils/publicAsset.js";
import { LTC_TABLE_SIDE, decodeLtcTablesBinary } from "./ltcTablesBinary.js";

export const LTC_TABLES_ASSET_PATH = "lighting/ltc-tables.bin";

let tablesReady = false;
let inFlightLoad = null;
let lastLoadError = "";


function createLtcDataTexture(halfValues) {
  const texture = new THREE.DataTexture(
    halfValues,
    LTC_TABLE_SIDE,
    LTC_TABLE_SIDE,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
    THREE.UVMapping,
    THREE.ClampToEdgeWrapping,
    THREE.ClampToEdgeWrapping,
    THREE.LinearFilter,
    THREE.NearestFilter,
    1,
  );
  texture.needsUpdate = true;
  return texture;
}


function installLtcUniforms(tables) {
  const firstTexture = createLtcDataTexture(tables.firstTable);
  const secondTexture = createLtcDataTexture(tables.secondTable);
  THREE.UniformsLib.LTC_FLOAT_1 = firstTexture;
  THREE.UniformsLib.LTC_FLOAT_2 = secondTexture;
  THREE.UniformsLib.LTC_HALF_1 = firstTexture;
  THREE.UniformsLib.LTC_HALF_2 = secondTexture;
}

function reportLoadFailure(error) {
  lastLoadError = String((error && error.message) || error);
  try {
    console.warn("[lighting/ltcTablesLoader] LTC tables unavailable:", error);
  } catch {

  }
}


export function ensureLtcTablesLoaded() {
  if (tablesReady) return Promise.resolve(true);
  if (!inFlightLoad) {
    inFlightLoad = fetchPublicArrayBuffer(LTC_TABLES_ASSET_PATH)
      .then((arrayBuffer) => {
        installLtcUniforms(decodeLtcTablesBinary(arrayBuffer));
        tablesReady = true;
        lastLoadError = "";
        return true;
      })
      .catch((error) => {
        reportLoadFailure(error);
        inFlightLoad = null;
        return false;
      });
  }
  return inFlightLoad;
}

export function areLtcTablesReady() {
  return tablesReady;
}

export function getLtcTablesLoadError() {
  return lastLoadError;
}

export function resetLtcTablesForTests() {
  tablesReady = false;
  inFlightLoad = null;
  lastLoadError = "";
}
