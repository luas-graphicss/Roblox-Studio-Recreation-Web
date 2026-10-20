import { MONACO_CDN_ROOT } from "../security/vendorIntegrity.js";
import { loadTrustedScript } from "./trustedScriptLoader.js";


const VS = MONACO_CDN_ROOT + "/min/vs";
const MONACO_LOADER_URL = VS + "/loader.js";
const MONACO_WORKER_MAIN_URL = VS + "/base/worker/workerMain.js";

let _promise = null;

async function injectLoader() {
  if (typeof document === "undefined") throw new Error("Sem DOM para carregar o Monaco.");
  if (window.require && window.require.config) return;


  try {
    await loadTrustedScript(MONACO_LOADER_URL);
  } catch (cause) {
    throw new Error("Falha ao carregar o loader do Monaco.", { cause });
  }
}


function buildWorkerBootstrapUrl() {
  const bootstrapSource =
    "self.MonacoEnvironment = { baseUrl: '" + VS + "/' };\n" +
    "importScripts('" + MONACO_WORKER_MAIN_URL + "');";
  return URL.createObjectURL(new Blob([bootstrapSource], { type: "text/javascript" }));
}

function configureWorkerEnvironment() {
  if (typeof window === "undefined") return;
  window.MonacoEnvironment = { getWorkerUrl: buildWorkerBootstrapUrl };
}


export function loadMonaco() {
  if (typeof window !== "undefined" && window.monaco) {
    return Promise.resolve(window.monaco);
  }
  if (_promise) return _promise;

  _promise = injectLoader()
    .then(
      () =>
        new Promise((resolve, reject) => {
          try {
            configureWorkerEnvironment();
            window.require.config({ paths: { vs: VS } });
            window.require(
              ["vs/editor/editor.main"],
              () => {
                if (window.monaco) resolve(window.monaco);
                else reject(new Error("Monaco carregou mas o global esta ausente."));
              },
              (err) => reject(err || new Error("Falha ao resolver o modulo do Monaco.")),
            );
          } catch (err) {
            reject(err);
          }
        }),
    )
    .catch((err) => {

      _promise = null;
      throw err;
    });

  return _promise;
}


export function isMonacoLoading() {
  return _promise !== null;
}
