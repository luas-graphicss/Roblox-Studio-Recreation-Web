import {debugRampColor} from './sbDebugVisualizationCore.js';

export function installRuntimeControlBridge(lab) {
  const notify = () => {
    lab.refreshPanel?.();
    if (typeof globalThis.window?.dispatchEvent === 'function') window.dispatchEvent(new Event('sb:state-change'));
  };
  function wrap(surface, name, uniformName = null, redraw = true, minimumArguments = 0) {
    const original = surface?.[name];
    if (typeof original !== 'function' || original.runtimeConnected) return;
    const connected = function (...args) {
      const result = original.apply(surface, args);
      if (args.length < minimumArguments || result?.ok === false || result?.accepted === false || result?.applied === false) return result;
      if (uniformName) lab.runtime.override(uniformName, true);
      if (redraw) lab.redraw();
      notify();
      return result;
    };
    connected.runtimeConnected = true;
    surface[name] = connected;
  }
  const visualization = lab.debugVisualization;
  if (visualization) {
    const evaluate = visualization.report.bind(visualization);
    visualization.report = request => {
      if (request?.closures) return evaluate(request);
      const target = lab.runtime.target();
      const entry = lab.runtime.frame()?.substrateMaterials?.find(item => item.id === target);
      const closures = entry?.result.closures.slice(0, entry.uniforms.uSbClosureCount.value) ?? [];
      const report = evaluate({tierName:lab.tier(), closures});
      const stride = entry?.result.buffer?.strideBytes ?? 0;
      report.bytes.bytesPerPixel = closures.length * stride;
      report.bytes.withinTierCeiling = report.bytes.bytesPerPixel <= report.bytes.tierCeiling;
      report.bytes.headroomBytes = report.bytes.tierCeiling - report.bytes.bytesPerPixel;
      report.bytes.ratio = report.bytes.bytesPerPixel / report.bytes.contractCeiling;
      report.bytes.color = debugRampColor(report.bytes.ratio);
      report.inspector.totalBytes = report.bytes.bytesPerPixel;
      report.inspector.rows.forEach((row, index) => { row.bytes = stride; row.parameters = {...closures[index].parameters}; });
      if (report.modeId === 'bytesPerPixel') { report.ratio = report.bytes.ratio; report.color = report.bytes.color; }
      report.source = 'selected-scene-material';
      report.target = target;
      report.gpuStrideBytes = stride;
      report.paintsPixel = report.paintsPixel && visualization.isActive() && !!entry?.enabled;
      return report;
    };
    const setMode = visualization.setMode.bind(visualization);
    visualization.setMode = mode => {
      const result = setMode(mode);
      if (result.accepted) { lab.flag(visualization.flagId, mode !== 'off'); lab.redraw(); notify(); }
      return result;
    };
  }
  for (const [surfaceName, names, uniform] of [
    ['anisotropy',['apply'],'uSbAnisotropy'],
    ['dualSpecularLobe',['set','off'],'uSbSecondLobe'],
    ['fuzzSheen',['set'],'uSbFuzz'],
    ['thinFilm',['set','preset'],'uSbThinFilm'],
    ['glints',['density','roughness','seed','preset'],'uSbGlint'],
    ['specularProfile',['select'],'uSbSpecularProfileIndex'],
    ['subsurface',['setMeanFreePath','setMode']],
    ['thinTranslucency',['profile'],'uSbThinTranslucency'],
    ['thinTranslucency',['apply','clear']],
    ['hair',['set','reset','retag']],
    ['eye',['set','reset','retag']],
    ['water',['setDepth','setMedium']],
    ['materialDomains',['select','clear','tune']],
    ['futureIntegration',['safeMode','restore']],
  ]) for (const name of names) wrap(lab[surfaceName], name, uniform, true, ['density','roughness','seed','preset','profile','apply'].includes(name) ? 1 : 0);
  if (lab.closureDispatch) {
    lab.closureDispatch.setClosureCount = count => {
      const result = lab.runtime.setClosureLimit(count);
      lab.redraw(); notify(); return result;
    };
  }
  for (const name of ['scene','tier','materialPath','flag','clearFlags','setUniform','redraw','allFlags']) wrap(lab, name, null, false, name === 'flag' ? 2 : ['scene','tier','materialPath'].includes(name) ? 1 : 0);
  lab.clearUniformOverrides = () => { lab.runtime.clearOverrides(); lab.redraw(); return {ok:true}; };
  if (visualization?.mode() === 'off') lab.flag(visualization.flagId, false);
  notify();
  return {notify};
}
