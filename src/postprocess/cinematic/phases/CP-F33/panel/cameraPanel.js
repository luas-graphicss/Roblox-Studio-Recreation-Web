import { CAMERA_NUMBER_FIELDS, CAMERA_CHOICE_FIELDS } from "../cameraAuthoring.js";
import { createAuthoredField } from "./authoredField.js";

export function renderCameraPanel(context) {
  const { elements, session, run, state, refresh } = context; const document = session.snapshot().document;
  const panel = elements.section("Physical camera", "CP-F03 applies lens projection before scene capture. Aperture and focus remain physical state; this fixture does not install a depth-of-field effect.");
  const viewIds = [...new Set([...(context.cameraViewIds ?? []), ...Object.keys(document.camera.views)])];
  const scopes = [{ label: "Global defaults", value: "global" }, ...viewIds.map(id => ({ label: id, value: `view:${id}` }))];
  const scope = scopes.some(option => option.value === state.cameraView) ? state.cameraView : "global";
  state.cameraView = scope;
  const viewId = scope.slice(5);
  panel.append(elements.select("Camera scope", scopes, scope, value => { state.cameraView = value; refresh(); }, "cp33-camera-scope"));
  const settings = scope === "global" ? document.camera.global : document.camera.views[viewId] ?? {};
  const defaults = { enabled: true, focalLengthMm: 35, sensorWidthMm: 36, sensorHeightMm: 24, apertureFNumber: 2.8, minApertureFNumber: 1.4, focusDistanceMeters: 6, focusOffsetMeters: 0, iso: 100, shutterSeconds: 1 / 120, squeezeFactor: 1, overscan: 1, gateFit: "crop", focusMode: "manual" };
  for (const [name, defaultValue] of Object.entries(defaults)) {
    const range = CAMERA_NUMBER_FIELDS[name];
    panel.append(createAuthoredField(elements, run, { id: `cp33-camera-${name}`, label: name, value: settings[name], defaultValue, minimum: range?.[0], maximum: range?.[1], choices: CAMERA_CHOICE_FIELDS[name],
      onChange(value) { session.edit(draft => { const target = scope === "global" ? draft.camera.global : draft.camera.views[viewId] ??= {}; if (value === undefined) delete target[name]; else target[name] = value; }); }
    }));
  }
  panel.append(elements.element("p", "Tracking targets, world units, shutter angles and rack-focus keys are editable in Document JSON with full validation.", { className: "cp33-description" })); return panel;
}
