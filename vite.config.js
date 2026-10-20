import { createCdnImportMapPlugin } from "./tools/build/cdnImportMapPlugin.js";
import { createClassicBootScriptPlugin } from "./tools/build/classicBootScriptPlugin.js";
import { createContentSecurityPolicyPlugin } from "./tools/build/contentSecurityPolicyPlugin.js";
import { createDeployHeadersPlugin } from "./tools/build/deployHeadersPlugin.js";


export const MANUAL_CHUNKS = Object.freeze({
  luauVm: ["./src/runtime/lua/luau/luauVmPayload.js"],
  lighting: ["./src/viewport/lightingRender.js"],


  help: ["./src/ui/whatsNewPanel.js", "./src/ui/helpDialogs.js"],
  editorDialogs: [
    "./src/ui/modal.js",
    "./src/ui/dialogs/projectDialogs.js",
    "./src/ui/dialogs/studioSettings.js",
  ],
  cloudAndPackages: [
    "./src/cloud/cloudPublish.js",
    "./src/packages/packages.js",
    "./src/packages/packageStore.js",
  ],
  runtimeGameplay: [
    "./src/runtime/gameplayObjects.js",
    "./src/runtime/monetization.js",
  ],
});


export const BUILD_TARGET = "es2022";



export const DEV_SERVER_PORT = 5173;






export const DEV_SERVER_HOST = "127.0.0.1";

export default {


  base: "./",
  worker: { format: "es" },
  plugins: [
    createCdnImportMapPlugin(),
    createClassicBootScriptPlugin(),


    createContentSecurityPolicyPlugin(),
    createDeployHeadersPlugin(),
  ],
  build: {
    target: BUILD_TARGET,


    sourcemap: false,
    rollupOptions: {
      output: { manualChunks: MANUAL_CHUNKS },
    },
  },
  server: {
    port: DEV_SERVER_PORT,
    strictPort: true,


    host: DEV_SERVER_HOST,
    cors: false,
    fs: { strict: true },
  },
};
