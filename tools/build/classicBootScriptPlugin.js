import { readFile } from "node:fs/promises";
import { join } from "node:path";


export const CLASSIC_BOOT_SCRIPT_PATHS = Object.freeze([
  "src/core/themePreload.js",
]);

export function createClassicBootScriptPlugin({
  scriptPaths = CLASSIC_BOOT_SCRIPT_PATHS,
  rootDirectory = ".",
} = {}) {
  return {
    name: "rsw-copy-classic-boot-scripts",
    apply: "build",
    scriptPaths,
    rootDirectory,
    async generateBundle() {
      for (const scriptPath of scriptPaths) {
        let scriptSource = null;
        try {
          scriptSource = await readFile(join(rootDirectory, scriptPath), "utf8");
        } catch (readError) {
          this.warn(
            "classic boot script not found, the built page would 404 on it: " +
              scriptPath
          );
          continue;
        }
        this.emitFile({
          type: "asset",
          fileName: scriptPath,
          source: scriptSource,
        });
      }
    },
  };
}
