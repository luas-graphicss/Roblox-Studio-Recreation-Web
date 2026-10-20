import { createHash } from "node:crypto";

const VENDOR_RESOURCES = {
  monacoLoader: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js",
  monacoWorkerMain: "https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/base/worker/workerMain.js",
  three: "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js",
};

async function computeIntegrity(resourceUrl) {
  const response = await fetch(resourceUrl);
  if (!response.ok) throw new Error("HTTP " + response.status);
  const responseBody = Buffer.from(await response.arrayBuffer());
  return "sha384-" + createHash("sha384").update(responseBody).digest("base64");
}

for (const [resourceName, resourceUrl] of Object.entries(VENDOR_RESOURCES)) {
  try {
    console.log(resourceName + " " + (await computeIntegrity(resourceUrl)));
  } catch (error) {
    console.log(resourceName + " ERROR " + error.message);
  }
}
