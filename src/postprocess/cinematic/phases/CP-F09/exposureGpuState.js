import { EXPOSURE_ADAPTATION_FRAGMENT } from "./exposureAdaptationShader.js";
import { EXPOSURE_STATE_LAYOUT, MAX_COMPENSATION_CURVE_POINTS } from "./exposureContract.js";
import { physicalCameraEv100 } from "./physicalExposure.js";

export function createExposureGpuState(rendererAdapter) {
  const { THREE } = rendererAdapter;
  const placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  placeholder.needsUpdate = true;
  const uniforms = {
    previousStateTexture: { value: placeholder },
    meteringTexture: { value: placeholder },
    hasPreviousState: { value: false },
    meteringUsesTexture: { value: false },
    meteringEvUv: { value: [0.5, 0.5] },
    meteringHasWeight: { value: false },
    meteredEv100: { value: 0 },
    manualEv100: { value: 0 },
    automaticMode: { value: true },
    frozenExposure: { value: false },
    minimumEv100: { value: 0 },
    maximumEv100: { value: 0 },
    compensationStops: { value: 0 },
    speedUpStopsPerSecond: { value: 0 },
    speedDownStopsPerSecond: { value: 0 },
    transitionDistanceStops: { value: 0 },
    deltaSeconds: { value: 0 },
    exposureScale: { value: 1 },
    framePreExposure: { value: 1 },
    curvePointCount: { value: 0 },
    curvePoints: { value: new Float32Array(MAX_COMPENSATION_CURVE_POINTS * 2) }
  };
  const material = rendererAdapter.createMaterial(EXPOSURE_ADAPTATION_FRAGMENT, uniforms);
  let disposed = false;

  return Object.freeze({
    render({ settings, metering, previous, frame, target }) {
      if (disposed) throw new Error("Exposure GPU state is disposed");
      if (previous?.texture === target.texture || metering?.texture === target.texture) throw new Error("Exposure adaptation texture feedback");
      const automatic = settings.editorEv100 === null && settings.mode === "auto";
      if (automatic && !metering) throw new Error("Automatic exposure requires an explicit metering input");
      uniforms.previousStateTexture.value = previous?.texture ?? placeholder;
      uniforms.meteringTexture.value = metering?.texture ?? placeholder;
      uniforms.hasPreviousState.value = Boolean(previous);
      uniforms.meteringUsesTexture.value = Boolean(metering?.texture);
      uniforms.meteringEvUv.value = metering?.evUv ?? [0.5, 0.5];
      uniforms.meteringHasWeight.value = Boolean(metering?.requiresPositiveWeight);
      uniforms.meteredEv100.value = metering?.value ?? 0;
      uniforms.manualEv100.value = automatic ? 0 : settings.editorEv100 ?? settings.manualEv100 ?? physicalCameraEv100(frame.camera);
      uniforms.automaticMode.value = automatic;
      uniforms.frozenExposure.value = settings.frozen;
      uniforms.minimumEv100.value = settings.minEv100;
      uniforms.maximumEv100.value = settings.maxEv100;
      for (const name of ["compensationStops", "speedUpStopsPerSecond", "speedDownStopsPerSecond", "transitionDistanceStops", "exposureScale"]) uniforms[name].value = settings[name];
      uniforms.deltaSeconds.value = frame.deltaSeconds;
      uniforms.framePreExposure.value = frame.preExposure;
      const points = settings.compensationCurve?.points ?? [];
      uniforms.curvePointCount.value = points.length;
      for (let index = 0; index < points.length; index += 1) {
        uniforms.curvePoints.value[index * 2] = points[index].ev100;
        uniforms.curvePoints.value[index * 2 + 1] = points[index].compensationStops;
      }
      if (target.width !== EXPOSURE_STATE_LAYOUT.width || target.height !== 1) throw new Error("Invalid exposure state target dimensions");
      rendererAdapter.draw(material, target);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      material.dispose();
      placeholder.dispose();
    }
  });
}
