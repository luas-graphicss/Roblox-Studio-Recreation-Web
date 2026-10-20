import { logger } from "./logger.js";

let registered = false;

export function registerGlobalErrorHandlers() {
  if (registered) return;
  registered = true;

  window.addEventListener("error", (event) => {
    logger.error("Erro não tratado:", event && event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    logger.error("Promessa rejeitada sem tratamento:", event && event.reason);
  });
}
