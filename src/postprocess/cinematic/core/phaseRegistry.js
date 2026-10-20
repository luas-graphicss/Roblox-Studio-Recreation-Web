import phase01 from "../phases/CP-F01/index.js";
import phase02 from "../phases/CP-F02/index.js";
import phase03 from "../phases/CP-F03/index.js";
import phase04 from "../phases/CP-F04/index.js";
import phase05 from "../phases/CP-F05/index.js";
import phase06 from "../phases/CP-F06/index.js";
import phase07 from "../phases/CP-F07/index.js";
import phase08 from "../phases/CP-F08/index.js";
import phase09 from "../phases/CP-F09/index.js";
import phase10 from "../phases/CP-F10/index.js";
import phase11 from "../phases/CP-F11/index.js";
import phase12 from "../phases/CP-F12/index.js";
import phase13 from "../phases/CP-F13/index.js";
import phase14 from "../phases/CP-F14/index.js";
import phase15 from "../phases/CP-F15/index.js";
import phase16 from "../phases/CP-F16/index.js";
import phase17 from "../phases/CP-F17/index.js";
import phase18 from "../phases/CP-F18/index.js";
import phase19 from "../phases/CP-F19/index.js";
import phase20 from "../phases/CP-F20/index.js";
import phase21 from "../phases/CP-F21/index.js";
import phase22 from "../phases/CP-F22/index.js";
import phase23 from "../phases/CP-F23/index.js";
import phase24 from "../phases/CP-F24/index.js";
import phase25 from "../phases/CP-F25/index.js";
import phase26 from "../phases/CP-F26/index.js";
import phase27 from "../phases/CP-F27/index.js";
import phase28 from "../phases/CP-F28/index.js";
import phase29 from "../phases/CP-F29/index.js";
import phase30 from "../phases/CP-F30/index.js";
import phase31 from "../phases/CP-F31/index.js";
import phase32 from "../phases/CP-F32/index.js";
import phase33 from "../phases/CP-F33/index.js";
import phase34 from "../phases/CP-F34/index.js";
import phase35 from "../phases/CP-F35/index.js";
import phase36 from "../phases/CP-F36/index.js";

export const PHASE_MODULES = Object.freeze({
  "src/phases/CP-F01/index.js": phase01,
  "src/phases/CP-F02/index.js": phase02,
  "src/phases/CP-F03/index.js": phase03,
  "src/phases/CP-F04/index.js": phase04,
  "src/phases/CP-F05/index.js": phase05,
  "src/phases/CP-F06/index.js": phase06,
  "src/phases/CP-F07/index.js": phase07,
  "src/phases/CP-F08/index.js": phase08,
  "src/phases/CP-F09/index.js": phase09,
  "src/phases/CP-F10/index.js": phase10,
  "src/phases/CP-F11/index.js": phase11,
  "src/phases/CP-F12/index.js": phase12,
  "src/phases/CP-F13/index.js": phase13,
  "src/phases/CP-F14/index.js": phase14,
  "src/phases/CP-F15/index.js": phase15,
  "src/phases/CP-F16/index.js": phase16,
  "src/phases/CP-F17/index.js": phase17,
  "src/phases/CP-F18/index.js": phase18,
  "src/phases/CP-F19/index.js": phase19,
  "src/phases/CP-F20/index.js": phase20,
  "src/phases/CP-F21/index.js": phase21,
  "src/phases/CP-F22/index.js": phase22,
  "src/phases/CP-F23/index.js": phase23,
  "src/phases/CP-F24/index.js": phase24,
  "src/phases/CP-F25/index.js": phase25,
  "src/phases/CP-F26/index.js": phase26,
  "src/phases/CP-F27/index.js": phase27,
  "src/phases/CP-F28/index.js": phase28,
  "src/phases/CP-F29/index.js": phase29,
  "src/phases/CP-F30/index.js": phase30,
  "src/phases/CP-F31/index.js": phase31,
  "src/phases/CP-F32/index.js": phase32,
  "src/phases/CP-F33/index.js": phase33,
  "src/phases/CP-F34/index.js": phase34,
  "src/phases/CP-F35/index.js": phase35,
  "src/phases/CP-F36/index.js": phase36,
});

export function importRegisteredPhase(entry) {
  const phase = PHASE_MODULES[entry];
  if (!phase) return Promise.reject(new Error(`Phase entry is not registered: ${entry}`));
  return Promise.resolve({ default: phase });
}
