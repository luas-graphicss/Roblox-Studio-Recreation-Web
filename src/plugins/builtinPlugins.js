export const BUILTIN_PLUGIN_METAS = Object.freeze([
  {
    id: "rsw.part-color-randomizer",
    name: "Part Color Randomizer",
    creator: "RSW Labs",
    version: "1.0.0",
    icon: "paint",
    category: "Utility",
    hasSettings: false,
  },
  {
    id: "rsw.instance-counter",
    name: "Instance Counter",
    creator: "RSW Labs",
    version: "1.2.0",
    icon: "intvalue",
    category: "Utility",
    hasSettings: true,
  },
  {
    id: "rsw.quick-insert-templates",
    name: "Quick Insert Templates",
    creator: "RSW Labs",
    version: "1.1.0",
    icon: "model",
    category: "Building",
    hasSettings: false,
  },
  {
    id: "rsw.quick-properties",
    name: "Quick Properties",
    creator: "RSW Labs",
    version: "1.0.0",
    icon: "settings",
    category: "Utility",
    hasSettings: false,
  },
  {
    id: "rsw.terrain-tools",
    name: "Terrain Tools",
    creator: "RSW Labs",
    version: "1.0.0",
    icon: "terrain",
    category: "Building",
    hasSettings: true,
  },
]);


function initColorRandomizer(plugin) {
  const toolbar = plugin.CreateToolbar("Utilities");
  if (!toolbar) return;
  const btn = toolbar.CreateButton(
    "randomize-colors",
    "Randomize the color of selected parts",
    "paint",
    "Randomize",
  );
  if (!btn) return;

  btn.Click.Connect(() => {
    const parts = plugin
      .GetSelection()
      .filter((i) => i && !i.isDestroyed() && i.hasProperty("Color"));
    if (!parts.length) {
      plugin.Notify("Selecione uma ou mais Parts para colorir.");
      return;
    }

    const before = parts.map((p) => ({ inst: p, color: p.getProperty("Color") }));
    const after = parts.map((p) => ({
      inst: p,
      color: plugin.MakeColor(Math.random(), Math.random(), Math.random()),
    }));
    plugin.RecordAction(
      "Randomize colors",
      () => {
        for (const e of after) if (!e.inst.isDestroyed()) e.inst.setProperty("Color", e.color);
        return true;
      },
      () => {
        for (const e of before) if (!e.inst.isDestroyed()) e.inst.setProperty("Color", e.color);
      },
    );
    plugin.Notify(`Cores aleat\u00f3rias aplicadas a ${parts.length} part(s).`);
  });


  const sync = () => {
    btn.Enabled = plugin
      .GetSelection()
      .some((i) => i && !i.isDestroyed() && i.hasProperty("Color"));
  };
  plugin.SelectionChanged.Connect(sync);
  sync();
}


function initInstanceCounter(plugin) {
  const widget = plugin.CreateDockWidgetPluginGui("Instance Counter", {
    width: 250,
    height: 300,
  });
  if (!widget) return;

  const box = widget.GetContainer();
  const head = document.createElement("div");
  head.className = "rsw-icnt__total";
  const list = document.createElement("div");
  list.className = "rsw-icnt__list";
  box.append(head, list);


  function count() {
    const totals = new Map();
    let total = 0;
    const root = plugin.GetDataModel();
    const stack = root ? [root] : [];
    while (stack.length) {
      const inst = stack.pop();
      for (const child of inst.getChildren()) {
        total += 1;
        totals.set(child.className, (totals.get(child.className) || 0) + 1);
        stack.push(child);
      }
    }
    return { totals, total };
  }

  function render() {
    const { totals, total } = count();
    head.textContent = `Total: ${total} inst\u00e2ncia(s)`;
    const rows = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    list.replaceChildren();
    for (const [cls, n] of rows) {
      const row = document.createElement("div");
      row.className = "rsw-icnt__row";
      const name = document.createElement("span");
      name.textContent = cls;              
      const val = document.createElement("span");
      val.className = "rsw-icnt__n";
      val.textContent = String(n);
      row.append(name, val);
      list.appendChild(row);
    }
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "rsw-icnt__row";
      empty.textContent = "Nenhuma inst\u00e2ncia.";
      list.appendChild(empty);
    }
  }


  let refreshMs = Number(plugin.GetSetting("refreshMs"));
  if (!Number.isFinite(refreshMs) || refreshMs < 100) {
    refreshMs = 250;
    plugin.SetSetting("refreshMs", refreshMs);
  } else if (refreshMs > 60000) {


    refreshMs = 60000;
    plugin.SetSetting("refreshMs", refreshMs);
  }
  let scheduled = null;
  function schedule() {

    if (scheduled || !widget.Enabled) return;
    scheduled = setTimeout(() => {
      scheduled = null;


      if (!widget.Enabled) return;
      try {
        render();
      } catch (_) {

      }
    }, refreshMs);
  }

  plugin.OnEvent("instance:childAdded", schedule);
  plugin.OnEvent("instance:childRemoved", schedule);
  plugin.OnEvent("instance:destroying", schedule);
  widget.OnClose.Connect(() => {
    if (scheduled) {
      clearTimeout(scheduled);
      scheduled = null;
    }
  });


  const toolbar = plugin.CreateToolbar("Instance Counter");
  const toggleBtn = toolbar
    ? toolbar.CreateButton(
        "instance-counter",
        "Mostra ou esconde o widget Instance Counter",
        "intvalue",
        "Counter",
      )
    : null;
  if (toggleBtn) {
    toggleBtn.SetActive(!!widget.Enabled);
    toggleBtn.Click.Connect(() => {
      widget.Enabled = !widget.Enabled;
      toggleBtn.SetActive(!!widget.Enabled);
      if (widget.Enabled) {
        widget.BringToFront();
        render();                                     
      }
    });

    widget.OnClose.Connect(() => toggleBtn.SetActive(false));
  }

  render();
}


function makePart(plugin, name, sx, sy, sz, px, py, pz, color, parent) {
  const part = plugin.CreateInstance("Part", { name });
  if (!part) return null;
  if (part.hasProperty("Size")) part.setProperty("Size", plugin.MakeVector3(sx, sy, sz));
  if (part.hasProperty("Position")) part.setProperty("Position", plugin.MakeVector3(px, py, pz));
  if (part.hasProperty("Anchored")) part.setProperty("Anchored", true);
  if (color && part.hasProperty("Color")) part.setProperty("Color", color);
  if (parent) part.setParent(parent);
  return part;
}

function buildHouse(plugin, ox) {
  const model = plugin.CreateInstance("Model", { name: "House" });
  if (!model) return null;
  const wallC = plugin.MakeColor(0.85, 0.78, 0.62);
  const roofC = plugin.MakeColor(0.55, 0.22, 0.18);
  const floorC = plugin.MakeColor(0.45, 0.45, 0.48);
  makePart(plugin, "Floor", 12, 1, 10, ox, 0.5, 0, floorC, model);
  makePart(plugin, "WallBack", 12, 6, 1, ox, 4, -4.5, wallC, model);
  makePart(plugin, "WallFrontL", 4.5, 6, 1, ox - 3.75, 4, 4.5, wallC, model);
  makePart(plugin, "WallFrontR", 4.5, 6, 1, ox + 3.75, 4, 4.5, wallC, model);
  makePart(plugin, "DoorTop", 3, 1.5, 1, ox, 6.25, 4.5, wallC, model);
  makePart(plugin, "WallLeft", 1, 6, 10, ox - 5.5, 4, 0, wallC, model);
  makePart(plugin, "WallRight", 1, 6, 10, ox + 5.5, 4, 0, wallC, model);

  makePart(plugin, "Roof1", 13, 1, 11, ox, 7.5, 0, roofC, model);
  makePart(plugin, "Roof2", 9, 1, 8, ox, 8.5, 0, roofC, model);
  makePart(plugin, "Roof3", 5, 1, 5, ox, 9.5, 0, roofC, model);
  return model;
}

function buildBridge(plugin, ox) {
  const model = plugin.CreateInstance("Model", { name: "Bridge" });
  if (!model) return null;
  const stoneC = plugin.MakeColor(0.5, 0.5, 0.55);
  const woodC = plugin.MakeColor(0.5, 0.35, 0.2);
  makePart(plugin, "PillarA1", 2, 8, 2, ox - 8, 4, -2.5, stoneC, model);
  makePart(plugin, "PillarA2", 2, 8, 2, ox - 8, 4, 2.5, stoneC, model);
  makePart(plugin, "PillarB1", 2, 8, 2, ox + 8, 4, -2.5, stoneC, model);
  makePart(plugin, "PillarB2", 2, 8, 2, ox + 8, 4, 2.5, stoneC, model);
  makePart(plugin, "Deck", 24, 1, 6, ox, 8.5, 0, woodC, model);
  makePart(plugin, "RailL", 24, 1.5, 0.5, ox, 9.75, -2.75, woodC, model);
  makePart(plugin, "RailR", 24, 1.5, 0.5, ox, 9.75, 2.75, woodC, model);
  return model;
}

function buildTower(plugin, ox) {
  const model = plugin.CreateInstance("Model", { name: "Tower" });
  if (!model) return null;
  const c1 = plugin.MakeColor(0.55, 0.57, 0.6);
  const c2 = plugin.MakeColor(0.4, 0.42, 0.46);
  makePart(plugin, "Base", 8, 4, 8, ox, 2, 0, c2, model);
  makePart(plugin, "Mid1", 6.5, 6, 6.5, ox, 7, 0, c1, model);
  makePart(plugin, "Mid2", 5, 6, 5, ox, 13, 0, c2, model);
  makePart(plugin, "Top", 3.5, 5, 3.5, ox, 18.5, 0, c1, model);
  makePart(plugin, "Spire", 1, 4, 1, ox, 23, 0, plugin.MakeColor(0.8, 0.2, 0.2), model);
  return model;
}

function buildWall(plugin, ox) {
  const model = plugin.CreateInstance("Model", { name: "Wall" });
  if (!model) return null;
  const c = plugin.MakeColor(0.6, 0.6, 0.62);
  makePart(plugin, "WallBody", 16, 6, 1, ox, 3, 0, c, model);

  for (let i = 0; i < 4; i += 1) {
    makePart(plugin, "Merlon" + (i + 1), 2, 1.5, 1, ox - 6 + i * 4, 6.75, 0, c, model);
  }
  return model;
}

function initQuickTemplates(plugin) {
  const toolbar = plugin.CreateToolbar("Templates");
  if (!toolbar) return;
  const defs = [
    { id: "house", text: "House", icon: "model", tooltip: "Insere uma casa simples no Workspace", build: buildHouse },
    { id: "bridge", text: "Bridge", icon: "model", tooltip: "Insere uma ponte com pilares no Workspace", build: buildBridge },
    { id: "tower", text: "Tower", icon: "model", tooltip: "Insere uma torre vertical no Workspace", build: buildTower },
    { id: "wall", text: "Wall", icon: "part", tooltip: "Insere um muro com ameias no Workspace", build: buildWall },
  ];
  let inserted = 0;
  for (const def of defs) {
    const btn = toolbar.CreateButton(def.id, def.tooltip, def.icon, def.text);
    if (!btn) continue;
    btn.Click.Connect(() => {
      const ws = plugin.GetService("Workspace");
      if (!ws) {
        plugin.Notify("Workspace indispon\u00edvel.");
        return;
      }
      const offset = (inserted % 6) * 16;
      inserted += 1;
      const model = def.build(plugin, offset);
      if (!model) {
        plugin.Notify("Falha ao montar o template.");
        return;
      }

      plugin.RecordAction(
        `Insert template ${def.text}`,
        () => {
          if (model.isDestroyed()) return false;
          model.setParent(ws);
          plugin.SetSelection([model]);
          return true;
        },
        () => {
          model.setParent(null);
        },
      );
      plugin.Notify(`Template "${def.text}" inserido no Workspace.`);
    });
  }
}


const QUICK_PROPS = [
  "Name",
  "ClassName",
  "Parent",
  "Position",
  "Size",
  "Rotation",
  "Color",
  "Material",
  "Anchored",
  "Transparency",
];

function formatQuickValue(v) {
  if (v == null) return "-";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  if (typeof v === "object") {
    if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") {
      const f = (n) => Math.round(n * 100) / 100;
      return `${f(v.x)}, ${f(v.y)}, ${f(v.z)}`;
    }
    if (typeof v.r === "number" && typeof v.g === "number" && typeof v.b === "number") {
      const c = (n) => Math.round(n * 255);
      return `rgb(${c(v.r)}, ${c(v.g)}, ${c(v.b)})`;
    }
    return "[objeto]";
  }
  return String(v);
}

function initQuickProperties(plugin) {
  const widget = plugin.CreateDockWidgetPluginGui("Quick Properties", {
    InitialDockState: "Right",
    InitialEnabled: false,
    InitialEnabledShouldOverrideRestore: true,
    FloatingSize: { x: 280, y: 340 },
    MinSize: { x: 200, y: 160 },
    MaxSize: { x: 640, y: 900 },
  });
  if (!widget) return;
  const box = widget.GetContainer();
  box.classList.add("rsw-qprops");
  const head = document.createElement("div");
  head.className = "rsw-qprops__head";
  const list = document.createElement("div");
  list.className = "rsw-qprops__list";
  box.append(head, list);

  function render() {
    const sel = plugin.GetSelection().filter((i) => i && !i.isDestroyed());
    if (!sel.length) {
      head.textContent = "Nenhuma sele\u00e7\u00e3o";
      list.replaceChildren();
      return;
    }
    const inst = sel[0];
    head.textContent = sel.length > 1 ? `${inst.name} (+${sel.length - 1})` : inst.name;
    list.replaceChildren();
    for (const prop of QUICK_PROPS) {
      let value;
      if (prop === "ClassName") value = inst.className;
      else if (prop === "Name") value = inst.name;
      else if (prop === "Parent") {
        const parent = inst.getParent();
        value = parent ? parent.name : "-";
      } else if (inst.hasProperty(prop)) value = inst.getProperty(prop);
      else continue;
      const row = document.createElement("div");
      row.className = "rsw-qprops__row";
      const key = document.createElement("span");
      key.className = "rsw-qprops__key";
      key.textContent = prop;
      const val = document.createElement("span");
      val.className = "rsw-qprops__val";
      val.textContent = formatQuickValue(value);
      val.title = val.textContent;
      row.append(key, val);
      list.appendChild(row);
    }
  }

  let raf = 0;
  function schedule() {
    if (raf || !widget.Enabled) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }
  plugin.SelectionChanged.Connect(schedule);
  plugin.OnEvent("instance:propertyChanged", schedule);
  plugin.OnEvent("instance:parentChanged", schedule);
  widget.OnFocus.Connect(schedule);
  widget.OnClose.Connect(() => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });

  const toolbar = plugin.CreateToolbar("Quick Properties");
  const toggleBtn = toolbar
    ? toolbar.CreateButton(
        "quick-properties",
        "Mostra ou esconde o painel Quick Properties",
        "settings",
        "Quick Properties",
      )
    : null;
  if (toggleBtn) {
    toggleBtn.SetActive(!!widget.Enabled);
    toggleBtn.Click.Connect(() => {
      widget.Enabled = !widget.Enabled;
      toggleBtn.SetActive(!!widget.Enabled);
      if (widget.Enabled) {
        widget.BringToFront();
        schedule();
      }
    });
    widget.OnClose.Connect(() => toggleBtn.SetActive(false));
  }

  render();
}


const TERRAIN_TOOLS = [
  { id: "generate", text: "Generate", icon: "create", hint: "Gera terreno procedural na regi\u00e3o do brush" },
  { id: "grow", text: "Grow", icon: "scale", hint: "Expande o terreno ao redor do brush" },
  { id: "erode", text: "Erode", icon: "transform", hint: "Remove terreno suavemente ao redor do brush" },
  { id: "paint", text: "Paint", icon: "paint", hint: "Pinta o material do terreno sob o brush" },
];
const TERRAIN_MATERIALS = ["Grass", "Rock", "Sand", "Snow", "Mud", "Water"];

function makeSliderRow(labelText, min, max, value, suffix) {
  const row = document.createElement("label");
  row.className = "rsw-ttool__row";
  const lab = document.createElement("span");
  lab.className = "rsw-ttool__label";
  lab.textContent = labelText;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.value = String(value);
  const out = document.createElement("span");
  out.className = "rsw-ttool__value";
  const sync = () => {
    out.textContent = input.value + (suffix || "");
  };
  input.addEventListener("input", sync);
  sync();
  row.append(lab, input, out);
  return { row, input };
}

function initTerrainTools(plugin) {
  const toolbar = plugin.CreateToolbar("Terrain Tools");
  if (!toolbar) return;
  const tools = new Map();
  let activeId = null;

  function setActive(id) {
    activeId = id;
    for (const [tid, t] of tools) {
      t.btn.SetActive(tid === id);
      if (t.widget && tid !== id) t.widget.Enabled = false;
    }
  }

  function buildWidget(def) {
    const widget = plugin.CreateWidget(`Terrain: ${def.text}`, {
      FloatingSize: { x: 300, y: def.id === "paint" ? 280 : 230 },
      MinSize: { x: 240, y: 180 },
      MaxSize: { x: 520, y: 480 },
    });
    if (!widget) return null;
    const box = widget.GetContainer();
    box.classList.add("rsw-ttool");
    const hint = document.createElement("div");
    hint.className = "rsw-ttool__hint";
    hint.textContent = def.hint;
    const size = makeSliderRow("Brush Size", 1, 64, Number(plugin.GetSetting(def.id + ".size")) || 8, " studs");
    const strength = makeSliderRow("Strength", 1, 100, Number(plugin.GetSetting(def.id + ".strength")) || 50, "%");
    box.append(hint, size.row, strength.row);
    let material = null;
    if (def.id === "paint") {
      const row = document.createElement("label");
      row.className = "rsw-ttool__row";
      const lab = document.createElement("span");
      lab.className = "rsw-ttool__label";
      lab.textContent = "Material";
      material = document.createElement("select");
      material.className = "rsw-ttool__select";
      for (const mat of TERRAIN_MATERIALS) {
        const opt = document.createElement("option");
        opt.value = mat;
        opt.textContent = mat;
        material.appendChild(opt);
      }
      const savedMat = String(plugin.GetSetting("paint.material") || "Grass");
      if (TERRAIN_MATERIALS.includes(savedMat)) material.value = savedMat;
      row.append(lab, material);
      box.appendChild(row);
    }
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "rsw-ttool__apply";
    apply.textContent = "Aplicar";
    apply.addEventListener("click", () => {
      plugin.SetSetting(def.id + ".size", Number(size.input.value));
      plugin.SetSetting(def.id + ".strength", Number(strength.input.value));
      if (material) plugin.SetSetting("paint.material", material.value);
      const extra = material ? `, material ${material.value}` : "";
      plugin.Notify(
        `Terrain ${def.text}: brush ${size.input.value} studs, for\u00e7a ${strength.input.value}%${extra}.`,
      );
    });
    box.appendChild(apply);
    widget.OnClose.Connect(() => {
      if (activeId === def.id) setActive(null);
    });
    return widget;
  }

  function openTool(def) {
    const t = tools.get(def.id);
    if (!t) return;
    if (activeId === def.id) {
      if (t.widget) t.widget.Enabled = false;
      setActive(null);
      return;
    }
    if (!t.widget) t.widget = buildWidget(def);
    if (!t.widget) return;
    t.widget.Enabled = true;
    t.widget.BringToFront();
    setActive(def.id);
  }

  for (const def of TERRAIN_TOOLS) {
    const btn = toolbar.CreateButton(def.id, def.hint, def.icon, def.text);
    if (!btn) continue;
    tools.set(def.id, { btn, widget: null });
    btn.Click.Connect(() => openTool(def));
  }

  const menu = plugin.CreateMenu("Terrain Tools");
  if (menu) {
    for (const def of TERRAIN_TOOLS) {
      menu.AddItem(def.text, () => openTool(def));
    }
    plugin.AddMenuItem(menu, "Fechar ferramentas", () => {
      for (const [, t] of tools) {
        if (t.widget) t.widget.Enabled = false;
      }
      setActive(null);
    });
  }
}

const INITS = Object.freeze({
  "rsw.part-color-randomizer": initColorRandomizer,
  "rsw.instance-counter": initInstanceCounter,
  "rsw.quick-insert-templates": initQuickTemplates,
  "rsw.quick-properties": initQuickProperties,
  "rsw.terrain-tools": initTerrainTools,
});


export function getBuiltinInit(id) {
  return INITS[id] || null;
}
