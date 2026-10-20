import { integrityForUrl } from "../security/vendorIntegrity.js";

export function loadTrustedScript(scriptUrl) {
  return new Promise((resolve, reject) => {
    const integrity = integrityForUrl(scriptUrl);
    if (!integrity) {
      reject(new Error("Refusing to load an unpinned third-party script: " + scriptUrl));
      return;
    }

    const scriptElement = document.createElement("script");
    scriptElement.src = scriptUrl;
    scriptElement.async = false;
    scriptElement.integrity = integrity;

    scriptElement.crossOrigin = "anonymous";
    scriptElement.referrerPolicy = "no-referrer";
    scriptElement.addEventListener("load", () => resolve(scriptElement), { once: true });
    scriptElement.addEventListener(
      "error",
      () => reject(new Error("Integrity check failed or network error: " + scriptUrl)),
      { once: true },
    );
    document.head.appendChild(scriptElement);
  });
}
