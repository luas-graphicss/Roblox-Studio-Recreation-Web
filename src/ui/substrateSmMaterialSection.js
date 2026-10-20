import { SSM_PUBLIC_API } from '../lighting/substrateSm/ssmPublicApiCore.js';

function createElement(document, tagName, text = '', className = '') {
  const element = document.createElement(tagName);
  element.textContent = text;
  element.className = className;
  return element;
}

function createSelect(document, parent, labelText, choices) {
  const label = createElement(document, 'label', labelText);
  const select = createElement(document, 'select');
  select.setAttribute('aria-label', labelText);
  for (const [value, text] of choices) {
    const option = createElement(document, 'option', text);
    option.value = value;
    select.append(option);
  }
  label.append(select);
  parent.append(label);
  return select;
}

export function createSubstrateSmMaterialSection(parent, { settingsController, readReport, subscribe } = {}) {
  if (!parent?.ownerDocument || typeof settingsController?.read !== 'function'
    || typeof settingsController?.set !== 'function' || typeof readReport !== 'function') {
    throw new TypeError('A parent, settings controller and on-demand report reader are required.');
  }
  const document = parent.ownerDocument;
  if (!document.getElementById('rsw-substrate-sm-section-style')) {
    const stylesheet = document.createElement('link');
    stylesheet.id = 'rsw-substrate-sm-section-style';
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL('./substrateSmMaterialSection.css', import.meta.url).href;
    document.head.append(stylesheet);
  }
  const listeners = new AbortController();
  const section = createElement(document, 'section', '', 'ssm-editor-section');
  section.setAttribute('aria-label', 'Substrate SM settings and report');
  section.append(createElement(document, 'h3', 'Substrate SM'));
  section.append(createElement(document, 'p', 'ShadowMap + Realistic. Shares the authored material; does not change Future controls.', 'ssm-editor-note'));
  const controls = createElement(document, 'div', '', 'ssm-editor-controls');
  section.append(controls);
  const enabledSelect = createSelect(document, controls, 'SSM request', [
    ['auto', 'AUTO — release gated'], ['on', 'ON — safety gates apply'], ['off', 'OFF — previous backend'],
  ]);
  enabledSelect.title = SSM_PUBLIC_API.SubstrateSM.description;
  const qualitySelect = createSelect(document, controls, 'SSM requested quality',
    SSM_PUBLIC_API.SubstrateSMQuality.options.map(value => [value, value]));
  qualitySelect.title = SSM_PUBLIC_API.SubstrateSMQuality.description;
  const requestedStatus = createElement(document, 'p', '', 'ssm-editor-note');
  section.append(requestedStatus);
  const refreshButton = createElement(document, 'button', 'Refresh SSM report');
  refreshButton.type = 'button';
  refreshButton.dataset.action = 'refresh-ssm-report';
  section.append(refreshButton);
  const reportStatus = createElement(document, 'p', 'Effective quality and losses have not been inspected.', 'ssm-editor-status');
  reportStatus.setAttribute('role', 'status');
  reportStatus.setAttribute('aria-live', 'polite');
  section.append(reportStatus);
  const details = createElement(document, 'details', '', 'ssm-editor-report');
  details.append(createElement(document, 'summary', 'Runtime state and material losses'));
  const reportText = createElement(document, 'pre');
  reportText.tabIndex = 0;
  details.append(reportText);
  details.hidden = true;
  section.append(details);
  parent.append(section);
  let generation = 0;
  let disposed = false;

  function refreshSettings() {
    if (disposed) return;
    generation += 1;
    const settings = settingsController.read();
    enabledSelect.value = settings.enabled === null ? 'auto' : settings.enabled === true ? 'on' : settings.enabled === false ? 'off' : '';
    qualitySelect.value = typeof settings.quality === 'string' ? settings.quality : '';
    enabledSelect.disabled = !settings.available;
    qualitySelect.disabled = !settings.available;
    refreshButton.disabled = !settings.available;
    requestedStatus.textContent = settings.ok
      ? `Requested: ${enabledSelect.value.toUpperCase()} / ${settings.quality}. Current mode: ${settings.technology ?? 'unknown'} / ${settings.renderStyle ?? 'unknown'}.`
      : settings.refusals.map(entry => entry.reason).join(' ');
    reportStatus.textContent = 'Effective quality and losses have not been inspected. Refresh after any scene or source change.';
    reportStatus.dataset.error = 'false';
    details.hidden = true;
    reportText.textContent = '';
  }

  function changeSetting(propertyName, value) {
    const result = settingsController.set(propertyName, value);
    refreshSettings();
    if (!result.ok) {
      reportStatus.textContent = result.reason || 'The settings change was refused.';
      reportStatus.dataset.error = 'true';
    }
  }

  async function refreshReport() {
    if (disposed) return;
    const requestGeneration = ++generation;
    refreshButton.disabled = true;
    reportStatus.textContent = 'Reading the current renderer report…';
    reportStatus.dataset.error = 'false';
    details.hidden = true;
    try {
      const report = await readReport();
      if (disposed || generation !== requestGeneration) return;
      reportStatus.textContent = report.summary;
      reportStatus.dataset.error = String(report.available !== true);
      reportText.textContent = report.details || '';
      details.hidden = !reportText.textContent;
    } catch {
      if (disposed || generation !== requestGeneration) return;
      reportStatus.textContent = 'Renderer report unavailable. Effective quality and losses are not verified.';
      reportStatus.dataset.error = 'true';
      reportText.textContent = '';
    } finally {
      if (!disposed && generation === requestGeneration) refreshButton.disabled = false;
    }
  }

  const eventOptions = { signal: listeners.signal };
  enabledSelect.addEventListener('change', () => changeSetting('SubstrateSM',
    enabledSelect.value === 'auto' ? null : enabledSelect.value === 'on'), eventOptions);
  qualitySelect.addEventListener('change', () => changeSetting('SubstrateSMQuality', qualitySelect.value), eventOptions);
  refreshButton.addEventListener('click', refreshReport, eventOptions);
  const unsubscribe = typeof subscribe === 'function' ? subscribe(refreshSettings) : () => {};
  refreshSettings();

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    listeners.abort();
    unsubscribe();
    section.remove();
  }

  return Object.freeze({ element: section, refreshSettings, refreshReport, dispose });
}
