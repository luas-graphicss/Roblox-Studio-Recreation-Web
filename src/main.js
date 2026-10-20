import { applyLowPowerBootPresentation } from "./boot/lowPowerBootPresentation.js";
import { yieldToBrowserPaint } from "./boot/browserPaint.js";
import { getSharedLoadingScreen } from "./boot/sharedLoadingScreen.js";

applyLowPowerBootPresentation();

async function startApplication() {
  await yieldToBrowserPaint();
  const { boot } = await import("./core/bootstrap.js");
  await boot();
}

startApplication().catch((error) => {
  console.error("[RSW] Critical failure while starting the application:", error);
  getSharedLoadingScreen().showFailure("The application could not start. Reload to try again.");
});
