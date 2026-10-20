export function createAuthoredField(elements, run, { id, label, value, defaultValue, minimum, maximum, step = "any", choices, enabled, onEnabled, onChange, description }) {
  const { element, select } = elements;
  const field = element("div", undefined, { className: "cp33-field" });
  const heading = element("div", undefined, { className: "cp33-field-heading" });
  heading.append(element("label", label, { for: id }));
  if (onEnabled) {
    const toggle = element("input", undefined, { type: "checkbox", "aria-label": `${label} override enabled`, id: `${id}-enabled` });
    toggle.checked = enabled !== false;
    toggle.addEventListener("change", () => run(() => onEnabled(toggle.checked)));
    const toggleLabel = element("label", "Override", { className: "cp33-toggle" }); toggleLabel.prepend(toggle); heading.append(toggleLabel);
  }
  field.append(heading);
  const mode = value === undefined ? "Unset" : value === null ? "null" : value === "AUTO" ? "AUTO" : "Value";
  const effectiveValue = mode === "Value" ? value : defaultValue;
  const row = element("div", undefined, { className: "cp33-value-row" });
  let input;
  const options = choices ?? (typeof effectiveValue === "boolean" ? [{ label: "On", value: "true" }, { label: "Off", value: "false" }] : undefined);
  if (options) {
    input = element("select", undefined, { id, "aria-label": label });
    for (const option of options) input.append(element("option", option.label ?? option, { value: option.value ?? option }));
    input.value = String(effectiveValue);
  } else {
    const numeric = typeof effectiveValue === "number";
    input = element("input", undefined, { id, "aria-label": label, type: numeric ? "number" : "text", min: minimum, max: maximum, step: numeric ? step : undefined });
    input.value = typeof effectiveValue === "object" ? JSON.stringify(effectiveValue) : effectiveValue ?? "";
  }
  input.disabled = mode !== "Value";
  input.addEventListener("change", () => run(() => {
    let result = input.value;
    if (typeof defaultValue === "number") { if (!result.trim()) throw new TypeError(`${label} needs a number; choose null or Unset explicitly`); result = Number(result); if (!Number.isFinite(result)) throw new TypeError(`${label} needs a finite number`); }
    else if (typeof defaultValue === "boolean") result = result === "true";
    else if (Array.isArray(defaultValue)) result = JSON.parse(result);
    onChange(result);
  }));
  row.append(input, select(`${label} mode`, ["Value", "AUTO", "null", "Unset"], mode, next => onChange(next === "Unset" ? undefined : next === "Value" ? defaultValue : next === "null" ? null : "AUTO"), `${id}-mode`));
  field.append(row);
  if (typeof defaultValue === "number" && Number.isFinite(minimum) && Number.isFinite(maximum) && maximum - minimum <= 200) {
    const range = element("input", undefined, { type: "range", min: minimum, max: maximum, step: step === "any" ? 0.01 : step, "aria-label": `${label} slider`, className: "cp33-slider", id: `${id}-slider` });
    range.value = typeof effectiveValue === "number" ? effectiveValue : minimum; range.disabled = mode !== "Value";
    range.addEventListener("input", () => { input.value = range.value; });
    range.addEventListener("change", () => run(() => onChange(Number(range.value)))); field.append(range);
  }
  if (description) field.append(element("p", description, { className: "cp33-description" }));
  return field;
}
