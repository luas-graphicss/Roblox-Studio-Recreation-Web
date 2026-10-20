import { openConfirm } from "../modal.js";
import { logger } from "../../core/logger.js";
import { setStatus } from "../../core/project.js";
import { describeWipeReport, wipeLocalData } from "../../persistence/localDataWipe.js";

const CONFIRM_TITLE = "Erase all local data";
const CONFIRM_MESSAGE =
  "This removes every project, version, package, cloud asset, DataStore entry and saved setting kept in this browser, including AI API keys. Files you already downloaded are not affected. This cannot be undone.";
const ERASE_CHOICE = "erase";

function askForConfirmationWithModal() {
  return openConfirm({
    title: CONFIRM_TITLE,
    message: CONFIRM_MESSAGE,
    buttons: [
      { label: "Erase Everything", value: ERASE_CHOICE, kind: "primary" },
      { label: "Cancel", value: "cancel", kind: "ghost" },
    ],
    closeOnBackdrop: false,
  }).then((choice) => choice === ERASE_CHOICE);
}

function reloadPage() {
  try {
    location.reload();
  } catch (error) {
    logger.warn("[localData] could not reload the page after the wipe", error);
  }
}


export async function openEraseLocalDataDialog(dependencies) {
  const options = dependencies || {};
  const askForConfirmation = options.askForConfirmation || askForConfirmationWithModal;
  const wipe = options.wipeLocalData || wipeLocalData;
  const notify = options.notify || setStatus;
  const reload = options.reload || reloadPage;

  const confirmed = await askForConfirmation();
  if (!confirmed) return null;

  notify("Erasing local data...");
  let report = null;
  try {
    report = await wipe();
  } catch (error) {
    logger.error("[localData] the wipe failed", error);
    notify("Could not erase the local data.");
    return null;
  }

  const summary = describeWipeReport(report);
  logger.warn("[localData] " + summary);
  notify(summary);


  if (!report.blockedDatabases.length) reload();
  return report;
}
