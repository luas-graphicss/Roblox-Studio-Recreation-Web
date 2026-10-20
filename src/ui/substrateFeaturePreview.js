const definitions = [
  ["SubstrateAnisotropy", "Anisotropy"],
  ["SubstrateDualSpecularLobe", "Second specular lobe"],
  ["SubstrateFuzzSheen", "Fuzz / sheen"],
  ["SubstrateThinFilm", "Thin film"],
  ["SubstrateGlints", "Glints"],
  ["SubstrateSpecularProfile", "Specular profiles"],
  ["SubstrateSubsurface", "Subsurface scattering (screen)"],
  ["SubstrateOrderedTranslucency", "Ordered translucency (OIT)"],
  ["SubstrateDecalBuffer", "Decal buffer (DBuffer)"],
  ["SubstrateRoughnessTracking", "Reflection roughness tracking"],
  ["SubstrateDomainLightFunction", "Domain: light function"],
  ["SubstrateDomainPostProcess", "Domain: post process"],
];

export function createSubstrateFeaturePreview(parent, readHost) {
  const root = document.createElement("details");
  root.dataset.section = "feature-preview";
  const summary = document.createElement("summary");
  summary.textContent = "Feature switches — viewport session";
  const note = document.createElement("p");
  note.className = "sb-editor-note";
  note.textContent =
    "These switches affect the whole viewport, not saved scene settings. AUTO follows the tier; some effects are disabled by default on medium GPUs. The master rendering switch and safety gates still apply.";
  const grid = document.createElement("div");
  grid.className = "sb-editor-grid";
  root.append(summary, note, grid);
  parent.append(root);
  const rows = definitions.map(([id, name]) => {
    const label = document.createElement("label");
    const title = document.createElement("span");
    const select = document.createElement("select");
    select.setAttribute("aria-label", name + " preview");
    for (const value of ["auto", "on", "off"]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value.toUpperCase();
      select.append(option);
    }
    select.addEventListener("change", () => {
      readHost()?.flag(
        id,
        select.value === "auto" ? null : select.value === "on",
      );
      refresh();
    });
    label.append(title, select);
    grid.append(label);
    return { id, name, title, select };
  });
  function refresh() {
    const states = new Map(
      (readHost()?.flags() || []).map((state) => [state.id, state]),
    );
    for (const row of rows) {
      const state = states.get(row.id);
      row.title.textContent =
        row.name + " · " + (state ? (state.on ? "ON" : "OFF") : "unavailable");
      row.select.disabled = !state;
      row.select.value =
        state?.override == null ? "auto" : state.override ? "on" : "off";
    }
  }
  refresh();
  return { refresh };
}
