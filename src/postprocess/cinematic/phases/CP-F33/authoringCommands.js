import { copyAuthoringData, requireKeys, reject } from "./authoringData.js";
import { AUTHORING_SECTIONS } from "./authoringContract.js";

export function applyAuthoringCommands(document, input) {
  const commands = copyAuthoringData(input);
  if (!Array.isArray(commands) || commands.length > 1024) reject("invalid-commands", "$", "Expected at most 1024 commands");
  let draft = document;
  for (const command of commands) {
    if (command.type === "replace") { requireKeys(command, ["type", "value"], "$.command"); draft = copyAuthoringData(command.value); continue; }
    if (command.type === "preset") {
      requireKeys(command, ["type", "id"], "$.command");
      const preset = draft.presets.find(entry => entry.id === command.id);
      if (!preset) reject("unknown-preset", "$.command.id", "Preset does not exist");
      for (const section of AUTHORING_SECTIONS) draft[section] = copyAuthoringData(preset.state[section]);
      continue;
    }
    if (!["set", "remove"].includes(command.type)) reject("unknown-command", "$.command.type", "Unsupported command");
    requireKeys(command, command.type === "set" ? ["type", "path", "value"] : ["type", "path"], "$.command");
    const path = command.path;
    if (!Array.isArray(path) || !path.length || path.length > 32 || path.some(key => typeof key !== "string" || !key || ["__proto__", "constructor", "prototype"].includes(key))) reject("invalid-command-path", "$", "Use an array of safe property names");
    let parent = draft;
    for (const key of path.slice(0, -1)) {
      if (!parent || typeof parent !== "object" || !Object.hasOwn(parent, key)) reject("missing-command-parent", "$", "Command parent does not exist");
      parent = parent[key];
    }
    if (!parent || typeof parent !== "object") reject("invalid-command-parent", "$", "Command parent must be an object");
    const key = path.at(-1);
    if (Array.isArray(parent) && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) > parent.length)) reject("invalid-array-index", "$", "Array edits must remain dense");
    if (command.type === "remove") {
      if (!Object.hasOwn(parent, key)) reject("missing-command-target", "$", "Remove target does not exist");
      if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key];
    } else {
      if (!Object.hasOwn(command, "value")) reject("missing-command-value", "$", "Set requires a value");
      parent[key] = command.value;
    }
  }
  return draft;
}
