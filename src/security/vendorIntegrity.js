export const MONACO_VERSION = "0.45.0";
export const THREE_VERSION = "0.161.0";

export const MONACO_CDN_ROOT = "https://cdn.jsdelivr.net/npm/monaco-editor@" + MONACO_VERSION + "/min";
export const THREE_MODULE_URL =
  "https://cdn.jsdelivr.net/npm/three@" + THREE_VERSION + "/build/three.module.js";

const VENDOR_INTEGRITY_BY_URL = new Map([
  [
    MONACO_CDN_ROOT + "/vs/loader.js",
    "sha384-SF/kPhqG3NMxqsYAbQqHkdF53WQx8yTkY0Ys+M+ayeC20QNujPyyxIuUEdEf0eG/",
  ],
  [
    MONACO_CDN_ROOT + "/vs/base/worker/workerMain.js",
    "sha384-wMZsV4qzdiVWN9wE02TfiRCXWElEX1ALKM6BeBojaQGqa/c7jbdO5uqEZeyrvv4s",
  ],
  [THREE_MODULE_URL, "sha384-c1WSdrtrvLWoZQC5zBcuCBhTpWvCcKFvUPFkF9wsEestdGUyCxZPiVXzYCZEPRzJ"],
]);

export function integrityForUrl(resourceUrl) {
  return VENDOR_INTEGRITY_BY_URL.get(String(resourceUrl == null ? "" : resourceUrl)) || "";
}

export function isPinnedVendorUrl(resourceUrl) {
  return integrityForUrl(resourceUrl).length > 0;
}
