import { readFile } from "node:fs/promises";

export const DEPLOY_HEADERS_FILE_NAME = "_headers";

export function createDeployHeadersPlugin({ sourcePath = DEPLOY_HEADERS_FILE_NAME } = {}) {
  return {
    name: "rsw-copy-deploy-headers",
    apply: "build",
    sourcePath,
    async generateBundle() {
      let headerFileContent = null;
      try {
        headerFileContent = await readFile(sourcePath, "utf8");
      } catch (error) {


        this.warn(
          "missing " + sourcePath + ": the deployed site will have no " + DEPLOY_HEADERS_FILE_NAME,
        );
        return;
      }
      this.emitFile({
        type: "asset",
        fileName: DEPLOY_HEADERS_FILE_NAME,
        source: headerFileContent,
      });
    },
  };
}
