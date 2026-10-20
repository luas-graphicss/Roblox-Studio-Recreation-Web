import { openModal, makeButton, _el as el } from '../modal.js';
import { bus } from '../../core/eventBus.js';
import {
  field,
  sectionTitle,
  slider,
  selectInput,
} from './fields.js';
import { commands } from '../../core/commands.js';
import { store } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import { getService } from '../../datamodel/index.js';
import { assetStore, extOf } from '../../assets/assetStore.js';

let _open = false;
let _handle = null;


function grading() {
  try { return window.__rswGrading || null; } catch (_) { return null; }
}

function getLighting() {
  try {
    const dm = store.getDataModel && store.getDataModel();
    if (!dm) return null;
    const svc = getService(dm, 'Lighting');
    if (svc) return svc;
    return typeof dm.findFirstChild === 'function' ? dm.findFirstChild('Lighting') : null;
  } catch (_) { return null; }
}

function lpGet(prop) {
  const l = getLighting();
  return l && l.hasProperty && l.hasProperty(prop) ? l.getProperty(prop) : null;
}

function setLightingProp(prop, value) {
  const l = getLighting();
  if (!l || !l.hasProperty || !l.hasProperty(prop)) return;
  const before = l.getProperty(prop);
  if (before === value) return;
  commands.execute({
    name: 'Set Lighting.' + prop,
    do() { try { l.setProperty(prop, value); } catch (_) {} },
    undo() { try { l.setProperty(prop, before); } catch (_) {} },
  });
}


function pickLocalCube(onText) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.cube';
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  const cleanup = () => { if (input.parentNode) input.parentNode.removeChild(input); };
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    cleanup();
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (e) => onText(e.target.result, f.name);
    reader.onerror = () => logger.warn('gradingPanel: erro ao ler .cube');
    reader.readAsText(f);
  });


  input.addEventListener('cancel', cleanup);
  document.body.appendChild(input);
  input.click();
}


function dataUriToText(dataUri) {
  const s = String(dataUri || '');
  const comma = s.indexOf(',');
  if (s.slice(0, 5) !== 'data:' || comma < 0) return null;
  const meta = s.slice(0, comma);
  const payload = s.slice(comma + 1);
  try {
    if (/;base64$/i.test(meta)) {
      const bin = atob(payload);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch (_) { return null; }
}

export function openGradingPanel() {
  if (_open) {
    if (_handle) { try { _handle.dialog && _handle.dialog.focus(); } catch (_) {} }
    return _handle;
  }
  _open = true;
  try {
    return buildAndOpen();
  } catch (e) {
    _open = false;
    _handle = null;
    try { logger.warn('gradingPanel: falha ao abrir: ' + (e && e.message)); } catch (_) {}
    return null;
  }
}

function buildAndOpen() {
  const body = el('div', 'rsw-grading-panel');


  body.appendChild(sectionTitle('Color Grading Preset'));
  const PRESETS = [
    { value: 'None', label: 'None' },
    { value: 'FilmicCool', label: 'Filmic Cool' },
    { value: 'Golden', label: 'Golden' },
    { value: 'Noir', label: 'Noir' },
  ];
  const presetSel = selectInput(
    lpGet('ColorGradingPreset') || 'None',
    PRESETS,
    (v) => setLightingProp('ColorGradingPreset', v),
  );
  body.appendChild(field('Preset', presetSel));

  const lutAmountSlider = slider(
    lpGet('ColorGradingLutAmount') != null ? lpGet('ColorGradingLutAmount') : 1,
    (v) => setLightingProp('ColorGradingLutAmount', v),
    { min: 0, max: 1, step: 0.01 },
  );
  body.appendChild(field('LUT Amount', lutAmountSlider));

  body.appendChild(sectionTitle('White Balance'));
  const wbTempSlider = slider(
    lpGet('WhiteBalanceTemperature') != null ? lpGet('WhiteBalanceTemperature') : 6500,
    (v) => setLightingProp('WhiteBalanceTemperature', v),
    { min: 1500, max: 15000, step: 50 },
  );
  body.appendChild(field('Temperature (K)', wbTempSlider));

  const wbTintSlider = slider(
    lpGet('WhiteBalanceTint') != null ? lpGet('WhiteBalanceTint') : 0,
    (v) => setLightingProp('WhiteBalanceTint', v),
    { min: -1, max: 1, step: 0.01 },
  );
  body.appendChild(field('Tint', wbTintSlider));


  body.appendChild(sectionTitle('Wheels (Lift / Gamma / Gain)'));


  const wState = {
    lift: [0, 0, 0],
    gamma: [1, 1, 1],
    gain: [1, 1, 1],
    satZone: [1, 1, 1],
    conZone: [1, 1, 1],
  };
  try {
    const g = grading();
    const cur = g && g.get();
    const w = cur && cur.wheels;
    if (w) {
      for (const k of ['lift', 'gamma', 'gain', 'satZone', 'conZone']) {
        if (Array.isArray(w[k]) && w[k].length === 3) wState[k] = w[k].slice();
      }
    }
  } catch (_) {}

  function applyWheels() {
    const g = grading();
    if (g) try { g.setWheels(wState); } catch (_) {}
  }

  const CHANNELS = ['R', 'G', 'B'];
  const wheelSliders = [];                                                 

  function makeWheelGroup(vecKey, label, minV, maxV) {
    const vec = wState[vecKey];
    const group = el('div', 'rsw-grading-panel__group');
    group.appendChild(el('span', 'rsw-grading-panel__group-label', label));
    for (let i = 0; i < 3; i++) {

      const sl = (function(idx) {
        return slider(vec[idx], function(v) { vec[idx] = v; applyWheels(); }, { min: minV, max: maxV, step: 0.01 });
      }(i));
      wheelSliders.push({ key: vecKey, idx: i, ctrl: sl });
      group.appendChild(field(CHANNELS[i], sl));
    }
    return group;
  }

  body.appendChild(makeWheelGroup('lift', 'Lift', -1, 1));
  body.appendChild(makeWheelGroup('gamma', 'Gamma', 0.2, 5));
  body.appendChild(makeWheelGroup('gain', 'Gain', 0, 4));

  body.appendChild(sectionTitle('Zones'));

  body.appendChild(makeWheelGroup('satZone', 'Saturation Zone', 0, 4));
  body.appendChild(makeWheelGroup('conZone', 'Contrast Zone', 0.2, 4));


  body.appendChild(sectionTitle('LUT .cube'));

  const lutStatus = el('p', 'rsw-grading-panel__lut-status', 'Nenhum LUT carregado.');
  try {
    const g = grading();
    const cur = g && g.get();
    if (cur && cur.lut && cur.lut.on) {



      const name = cur.lut.source === 'preset'
        ? (cur.preset || 'preset')
        : (cur.lut.title || 'lut .cube');
      lutStatus.textContent = 'LUT: ' + name + ' (' + cur.lut.size + '\u00b3)';
    }
  } catch (_) {}
  body.appendChild(lutStatus);

  const btnRow = el('div', 'rsw-grading-panel__btnrow');


  function applyLutText(text, label) {
    const g = grading();
    if (!g) { logger.warn('gradingPanel: __rswGrading indisponível (sem WebGL).'); return; }
    try {
      const result = g.setLutText(text, label);
      if (result && result.size) {
        lutStatus.textContent = 'LUT: ' + label + ' (' + result.size + '\u00b3)';
      } else {
        lutStatus.textContent = 'LUT: ' + label + ' (tamanho desconhecido)';
      }
    } catch (e) {
      logger.warn('gradingPanel: falha ao carregar LUT: ' + (e && e.message));
      lutStatus.textContent = 'Erro ao carregar ' + label;
    }
  }


  const btnImportFile = makeButton('Importar .cube (arquivo)', 'secondary', function() {
    pickLocalCube(function(text, filename) { applyLutText(text, filename); });
  });
  btnRow.appendChild(btnImportFile);


  const btnBrowse = makeButton('Browse no Asset Manager', 'secondary', function() {
    bus.emit('assetmanager:pick', {
      section: 'images',
      onPick: function(assetId) {
        const rec = assetStore.getById(assetId);
        if (!rec) {
          logger.warn('gradingPanel: asset não encontrado: ' + assetId);
          lutStatus.textContent = 'Asset não encontrado no Asset Manager.';
          return;
        }
        const ext = String(rec.ext || extOf(rec.name) || '').toLowerCase();
        if (ext !== 'cube') {
          lutStatus.textContent = 'Selecione um arquivo .cube (escolhido: ' + (rec.name || assetId) + ').';
          return;
        }
        const text = dataUriToText(rec.dataUri);
        if (text == null) {
          logger.warn('gradingPanel: não foi possível ler o conteúdo do asset ' + assetId);
          lutStatus.textContent = 'Erro ao ler ' + rec.name + ' do Asset Manager.';
          return;
        }
        applyLutText(text, rec.name);
      },
    });
  });
  btnRow.appendChild(btnBrowse);


  const btnClear = makeButton('Limpar LUT', 'ghost', function() {
    const g = grading();
    if (!g) return;
    try { g.clearLut(); } catch (_) {}
    lutStatus.textContent = 'Nenhum LUT carregado.';
  });
  btnRow.appendChild(btnClear);


  const NEUTRAL = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], satZone: [1, 1, 1], conZone: [1, 1, 1] };
  const btnReset = makeButton('Reset Neutro', 'ghost', function() {
    for (const k of Object.keys(NEUTRAL)) {
      for (let i = 0; i < 3; i++) wState[k][i] = NEUTRAL[k][i];
    }
    for (const s of wheelSliders) {
      try { if (s.ctrl && typeof s.ctrl.setValue === 'function') s.ctrl.setValue(wState[s.key][s.idx]); } catch (_) {}
    }
    applyWheels();
  });
  btnRow.appendChild(btnReset);

  body.appendChild(btnRow);

  _handle = openModal({
    title: 'Color Grading',
    body,
    footer: makeButton('Fechar', 'primary', function() { if (_handle) _handle.close({ reason: 'done' }); }),
    width: 480,
    className: 'rsw-modal--grading',
    closeOnBackdrop: true,
    onClose: function() { _open = false; _handle = null; },
  });
  return _handle;
}
