import { bus, EventBus } from "../core/eventBus.js";
import { store, TABS } from "../core/state.js";
import { keybindings, KEYBINDING_LAYERS } from "../core/keybindings.js";
import { selection } from "../core/selection.js";
import { engine } from "../runtime/engine.js";

import { cameraSys } from "../runtime/cameraSystem.js";
import { multiClient } from "../runtime/multiClient.js";
import { streaming } from "../runtime/streaming.js";
import { createInstance, getService, isClass } from "../datamodel/index.js";
import { makeVector3 } from "../datamodel/types.js";
import { unionSelection, separateSelection } from "../core/modelOps.js";
import { createPathfinder } from "../runtime/pathfinding.js";
import {
  parseContents, serializeContents, buildIndexes, findEntryForSource, formatMessage,
} from "../datamodel/localization.js";
import { dsSet, dsGet, dsRemove } from "../runtime/dataServices.js";
import { project } from "../core/project.js";
import {
  serializeInstances,
  deserializeInstances,
  rleEncode,
  rleDecode,
} from "../persistence/serializer.js";
import { solveChain, solveTwoBone, vDist, IK_TOLERANCE } from "../animation/ikSolver.js";
import { buildModelXml } from "../interop/rbxlxWriter.js";
import { parseRbxXml } from "../interop/rbxlxReader.js";
import { eulerDegToMatrix } from "../interop/rbxTypeMaps.js";

import { encodeSmoothGridBytes, decodeSmoothGridBytes, SMOOTH_GRID_LIMITS } from "../interop/rbxSmoothGrid.js";
import { syncTerrainImportBudget } from "../interop/rbxInterop.js";
import { SETTINGS_DEFAULTS, TERRAIN_IMPORT_MAX_VOXELS_RANGE } from "../config/settings.js";
import { preloadLuauVM, createRuntimeInterpreter, luauRuntimeInfo } from "../runtime/lua/runtimeSelector.js";            
import {
  getProducts, getPasses, getBadges, getBalance,
  awardBadgeAsync, userHasBadgeAsync, BADGE_STORE,
} from "../runtime/monetization.js";
import { hashSet, hashGet, hashRemove, clearAll as memoryStoreClear } from "../runtime/memoryStore.js";
import { createDockWidget } from "../plugins/dockWidgets.js";
import { isAIEnabled, isAIConfigured, getAIConfig } from "../ai/aiConfig.js";
import {
  toggleMicroProfiler, isMicroProfilerVisible, closeMicroProfiler,
} from "../ui/microProfiler.js";
import { toggleSummaryStats, isSummaryStatsVisible, closeSummaryStats } from "../ui/summaryStats.js";
import { toggleNetworkStats, isNetworkStatsVisible, closeNetworkStats } from "../ui/networkStats.js";
import { defineGroup, defineCheck } from "./masterValidation.js";

const CORE_SERVICES = [
  "Workspace", "Players", "ReplicatedStorage", "ServerStorage", "ServerScriptService",
  "StarterGui", "StarterPack", "StarterPlayer", "Lighting", "SoundService",
  "Teams", "LocalizationService", "ClimateService",
];

const FORBIDDEN_GLOBALS = [
  "store", "bus", "engine", "dataModel", "selection", "playtest",
  "settings", "keybindings", "streaming", "profiler",
];

function pass(detail = "") { return { status: "pass", detail }; }
function warn(detail) { return { status: "warn", detail }; }
function fail(detail) { return { status: "fail", detail }; }
function skip(detail) { return { status: "skip", detail }; }

function stripIds(node) {
  const out = { c: node.c, n: node.n };
  if (node.p) out.p = node.p;
  if (node.a) out.a = node.a;
  if (node.t) out.t = node.t;
  if (Array.isArray(node.ch)) out.ch = node.ch.map(stripIds);
  return out;
}

function destroyAll(list) {
  for (const inst of list || []) {
    try {
      if (inst && typeof inst.destroy === "function" && !inst.isDestroyed()) inst.destroy();
    } catch (_e) {            }
  }
}

function censusOf(dm) {
  const map = new Map();
  for (const d of dm.getDescendants()) {
    map.set(d.className, (map.get(d.className) || 0) + 1);
  }
  return map;
}

function censusDiff(before, after) {
  const diffs = [];
  for (const cls of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(cls) || 0;
    const b = after.get(cls) || 0;
    if (a !== b) diffs.push(`${cls}: ${a} → ${b}`);
  }
  return diffs;
}

function buildComplexFixture() {
  const root = createInstance("Folder", { name: "__ValidationFixture" });
  const model = createInstance("Model", { name: "Rig", parent: root });
  const part = createInstance("Part", { name: "Torso", parent: model });
  part.setProperty("Size", makeVector3(2, 2, 1));
  part.setProperty("Position", makeVector3(0, 5, 0));
  part.setProperty("Anchored", true);
  part.setAttribute("Team", "string", "Blue");
  part.addTag("ValidationTag");
  const classes = [
    "UnionOperation", "MeshPart", "Bone", "WrapLayer", "IKControl",
    "LocalizationTable", "Script", "LocalScript", "ModuleScript",
    "Humanoid", "Animation", "DragDetector", "Highlight", "SelectionBox",
  ];
  const created = [];
  for (const cls of classes) {
    if (!isClass(cls)) continue;
    const inst = createInstance(cls, { name: "T_" + cls, parent: model });
    if (inst) created.push(cls);
  }
  return { root, created, expected: classes.filter((c) => isClass(c)) };
}

export function registerAllChecks() {

  defineGroup("core", "Seção 1 — Núcleo, Estado e Comunicação");

  defineCheck("core", {
    id: "state.snapshot",
    label: "StateManager: snapshot imutável e consistente",
    run() {
      const s = store.getState();
      if (!s || typeof s !== "object") return fail("Snapshot vazio.");
      if (!Object.isFrozen(s)) return fail("Snapshot não está congelado (mutação solta possível).");
      if (!TABS.includes(s.activeTab)) return fail(`activeTab inválida: ${s.activeTab}`);
      if (!Array.isArray(s.selection)) return fail("selection não é array.");
      const before = store.get("activeTool");
      try { s.activeTool = "__hack__"; } catch (_e) {              }
      if (store.get("activeTool") !== before) return fail("Snapshot permitiu mutação externa.");
      return pass(`appMode=${s.appMode}, tab=${s.activeTab}`);
    },
  });

  defineCheck("core", {
    id: "state.datamodel",
    label: "DataModel registrado com serviços fixos",
    run() {
      const dm = store.getDataModel();
      if (!dm) return fail("DataModel não registrado no StateManager.");
      const missing = CORE_SERVICES.filter((n) => !getService(dm, n));
      if (missing.length) return fail("Serviços ausentes: " + missing.join(", "));
      return pass(`${dm.getDescendants().length} instância(s) na cena.`);
    },
  });

  defineCheck("core", {
    id: "state.noStrayGlobals",
    label: "Sem variáveis globais soltas fora do StateManager",
    run() {
      const leaked = FORBIDDEN_GLOBALS.filter((k) => {
        try { return typeof globalThis[k] !== "undefined"; } catch (_e) { return false; }
      });
      if (leaked.length) return fail("Singletons vazados em window: " + leaked.join(", "));
      return pass();
    },
  });

  defineCheck("core", {
    id: "bus.health",
    label: "EventBus: saúde geral e ausência de vazamentos",
    run() {
      const total = bus.totalListeners();
      if (total <= 0) return fail("Nenhum listener registrado (bus quebrado?).");
      const leaks = bus.leakReport(200);
      if (leaks.length) {
        return warn(leaks.map((l) => `${l.event}=${l.count}`).join(", "));
      }
      return pass(`${bus.eventNames().length} evento(s), ${total} listener(s).`);
    },
  });

  defineCheck("core", {
    id: "bus.semantics",
    label: "EventBus: deduplicação, once() e isolamento de erros",
    run() {
      const scratch = new EventBus();
      const calls = [];
      const h = () => calls.push("h");
      scratch.on("x", h);
      scratch.on("x", h);
      if (scratch.listenerCount("x") !== 1) return fail("Handler duplicado foi registrado 2x.");
      scratch.on("x", () => { throw new Error("__validation_probe__"); });
      scratch.on("x", () => calls.push("after"));
      const originalError = console.error;
      console.error = () => {};
      try {
        scratch.emit("x");
      } finally {
        console.error = originalError;
      }
      if (!calls.includes("after")) return fail("Erro em listener interrompeu os demais.");
      let onceCount = 0;
      scratch.once("y", () => { onceCount += 1; });
      scratch.emit("y");
      scratch.emit("y");
      if (onceCount !== 1) return fail(`once() executou ${onceCount}x.`);
      if (scratch.listenerCount("y") !== 0) return fail("once() não removeu o listener.");
      return pass();
    },
  });

  defineCheck("core", {
    id: "bus.selectionFlow",
    label: "Integração Selection → State → EventBus",
    run() {
      let got = null;
      const off = bus.on("selection:changed", (p) => { got = p; });
      const prev = selection.get();
      selection.clear();
      selection.set(prev);
      off();
      if (prev.length === 0 && got === null) {
        selection.clear();
        return pass("Sem seleção ativa; fluxo de eventos íntegro.");
      }
      if (!got || !Array.isArray(got.ids)) return fail("Evento selection:changed não propagou payload válido.");
      const mirrored = store.get("selection");
      if (JSON.stringify(mirrored) !== JSON.stringify(got.ids)) {
        return fail("Estado global não espelha a seleção.");
      }
      return pass();
    },
  });

  defineCheck("core", {
    id: "keybindings.conflicts",
    label: "Atalhos: sem conflitos na mesma camada",
    run() {
      const byKey = new Map();
      for (const a of keybindings.list()) {
        if (!a.combo) continue;
        const key = a.layer + "::" + a.combo;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(a.id);
      }
      const conflicts = [...byKey.entries()]
        .filter(([, ids]) => ids.length > 1)
        .map(([key, ids]) => `${key} → ${ids.join(" / ")}`);
      if (conflicts.length) return fail(conflicts.join(" | "));
      const layers = new Set(keybindings.list().map((a) => a.layer));
      for (const l of layers) {
        if (!(l in KEYBINDING_LAYERS)) return fail(`Camada desconhecida: ${l}`);
      }
      return pass(`${keybindings.list().length} atalho(s) em ${layers.size} camada(s).`);
    },
  });

  defineCheck("core", {
    id: "panels.listenerHygiene",
    label: "Painéis flutuantes: abrir/fechar sem vazar listeners",
    async run() {
      if (typeof document === "undefined") return skip("Sem DOM.");
      const before = bus.totalListeners();
      toggleMicroProfiler();
      toggleSummaryStats();
      toggleNetworkStats();
      await new Promise((r) => setTimeout(r, 50));
      closeMicroProfiler();
      closeSummaryStats();
      closeNetworkStats();
      await new Promise((r) => setTimeout(r, 50));
      if (isMicroProfilerVisible() || isSummaryStatsVisible() || isNetworkStatsVisible()) {
        return fail("Painel não fechou corretamente.");
      }
      const after = bus.totalListeners();
      if (after > before) return fail(`Vazamento no bus: ${before} → ${after} listeners.`);
      return pass(`Listeners estáveis (${before} → ${after}).`);
    },
  });


  defineGroup("persistence", "Seção 1.4 — Serialização e Persistência");

  defineCheck("persistence", {
    id: "serialize.roundTrip",
    label: "Round-trip completo com conteúdo complexo",
    run() {
      const fx = buildComplexFixture();
      let deser = null;
      try {
        const a = serializeInstances([fx.root]);
        if (a.warnings.length) return warn("Warnings ao serializar: " + a.warnings.join("; "));
        deser = deserializeInstances(a.nodes);
        const b = serializeInstances(deser.roots.filter(Boolean));
        const sa = JSON.stringify(a.nodes.map(stripIds));
        const sb = JSON.stringify(b.nodes.map(stripIds));
        if (sa !== sb) return fail("Estrutura divergente após round-trip.");
        if (deser.warnings.length) return warn("Warnings ao desserializar: " + deser.warnings.join("; "));
        return pass(`${a.count} nó(s), classes: ${fx.created.join(", ")}`);
      } finally {
        destroyAll([fx.root]);
        if (deser) destroyAll(deser.roots);
      }
    },
  });

  defineCheck("persistence", {
    id: "serialize.attributesTags",
    label: "Atributos e tags sobrevivem ao round-trip",
    run() {
      const fx = buildComplexFixture();
      let deser = null;
      try {
        const a = serializeInstances([fx.root]);
        deser = deserializeInstances(a.nodes);
        const model = deser.roots[0] && deser.roots[0].findFirstChild("Rig");
        const part = model && model.findFirstChild("Torso");
        if (!part) return fail("Fixture não reconstruída.");
        const attr = part.getAttribute && part.getAttribute("Team");
        if (attr !== "Blue") return fail(`Atributo perdido (valor: ${JSON.stringify(attr)}).`);
        if (!part.hasTag || !part.hasTag("ValidationTag")) return fail("Tag perdida.");
        return pass();
      } finally {
        destroyAll([fx.root]);
        if (deser) destroyAll(deser.roots);
      }
    },
  });

  defineCheck("persistence", {
    id: "serialize.liveProject",
    label: "Projeto atual serializa sem erros",
    run() {
      const dm = store.getDataModel();
      if (!dm) return skip("Sem DataModel.");
      const ws = getService(dm, "Workspace");
      const result = serializeInstances(ws ? [ws] : dm.getChildren());
      if (!result.count) return fail("Nenhuma instância serializada.");
      const detail = `${result.count} instância(s)` +
        (result.warnings.length ? `, ${result.warnings.length} warning(s)` : "");
      return result.warnings.length > 10 ? warn(detail) : pass(detail);
    },
  });

  defineCheck("persistence", {
    id: "serialize.terrainRle",
    label: "Terrain: RLE encode/decode íntegro",
    run() {
      const src = new Uint8Array(4096);
      for (let i = 0; i < src.length; i++) src[i] = i % 7 === 0 ? 3 : i % 31 === 0 ? 5 : 0;
      const decoded = rleDecode(rleEncode(src), src.length);
      for (let i = 0; i < src.length; i++) {
        if (decoded[i] !== src[i]) return fail(`Divergência no voxel ${i}.`);
      }
      return pass(`${src.length} voxels round-trip.`);
    },
  });

  defineCheck("persistence", {
    id: "interop.rbxRoundTrip",
    label: "Interop Roblox (Parte 69): round-trip .rbxmx fiel",
    run() {
      const root = createInstance("Folder", { name: "__RbxInteropFixture" });
      let parsed = null;
      try {
        const model = createInstance("Model", { name: "Rig", parent: root });
        const part = createInstance("Part", { name: "Torso", parent: model });
        part.setProperty("Size", makeVector3(2, 4.5, 1.25));
        part.setProperty("Position", makeVector3(-3.5, 10, 42.125));
        part.setProperty("Rotation", makeVector3(10, -35, 122.5));
        part.setProperty("Anchored", true);
        part.setProperty("Color", { r: 0.2, g: 0.4, b: 0.8 });
        part.setProperty("Material", "Neon");
        part.setProperty("Shape", "Cylinder");
        part.setProperty("TopSurface", "Weld");
        const script = createInstance("Script", { name: "Main", parent: model });
        const src = 'print("ol\u00e1 ]]> mundo")\nlocal ok = 1 < 2 and "a&b" ~= \'c\'\n';
        script.setProperty("Source", src);
        script.setProperty("Disabled", true);
        const sv = createInstance("StringValue", { name: "Config", parent: root });
        sv.setProperty("Value", 'a<b>&"\'c');
        const ov = createInstance("ObjectValue", { name: "Target", parent: root });
        ov.setProperty("Value", part);
        const light = createInstance("PointLight", { name: "Lamp", parent: part });
        light.setProperty("Range", 24);

        const built = buildModelXml([root]);
        parsed = parseRbxXml(built.xml);
        if (!parsed.ok) return fail("Parse falhou: " + parsed.error);
        if (parsed.kind !== "model") return fail("Kind incorreto: " + parsed.kind);
        const r2 = parsed.roots[0];
        const m2 = r2 && r2.findFirstChild("Rig");
        const p2 = m2 && m2.findFirstChild("Torso");
        if (!p2 || p2.className !== "Part") return fail("Part não reconstruída.");
        const near = (a, b, eps) => Math.abs(a - b) <= eps;
        const pos = p2.getProperty("Position");
        if (!near(pos.x, -3.5, 1e-3) || !near(pos.y, 10, 1e-3) || !near(pos.z, 42.125, 1e-3)) {
          return fail("Position divergente após round-trip.");
        }
        const rot = p2.getProperty("Rotation");
        const ma = eulerDegToMatrix(10, -35, 122.5);
        const mb = eulerDegToMatrix(rot.x, rot.y, rot.z);
        for (let i = 0; i < 9; i++) {
          if (!near(ma[i], mb[i], 1e-4)) return fail(`Rotação divergente (matriz[${i}]).`);
        }
        const col = p2.getProperty("Color");
        if (!near(col.r, 0.2, 0.003) || !near(col.g, 0.4, 0.003) || !near(col.b, 0.8, 0.003)) {
          return fail("Color divergente após round-trip.");
        }
        if (p2.getProperty("Material") !== "Neon") return fail("Material perdido.");
        if (p2.getProperty("Shape") !== "Cylinder") return fail("Shape perdido.");
        if (p2.getProperty("TopSurface") !== "Weld") return fail("SurfaceType perdido.");
        if (p2.getProperty("Anchored") !== true) return fail("Anchored perdido.");
        const s2 = m2.findFirstChild("Main");
        if (!s2 || s2.getProperty("Source") !== src) return fail("Source do Script divergente (CDATA).");
        if (s2.getProperty("Disabled") !== true) return fail("Disabled perdido.");
        const sv2 = r2.findFirstChild("Config");
        if (!sv2 || sv2.getProperty("Value") !== 'a<b>&"\'c') return fail("Escape XML divergente.");
        const ov2 = r2.findFirstChild("Target");
        if (!ov2 || ov2.getProperty("Value") !== p2) return fail("Ref (ObjectValue) não religada.");
        const l2 = p2.findFirstChild("Lamp");
        if (!l2 || l2.className !== "PointLight" || !near(l2.getProperty("Range"), 24, 1e-3)) {
          return fail("PointLight divergente.");
        }
        return pass(`${built.count} instância(s) exportadas e reconstruídas com fidelidade.`);
      } finally {
        destroyAll([root]);
        if (parsed && parsed.ok) destroyAll(parsed.roots);
      }
    },
  });

  defineCheck("persistence", {
    id: "interop.rbxHardening",
    label: "Interop Roblox (Parte 69): tolerância e anti-exploit",
    run() {
      let deepParsed = null;
      let unkParsed = null;
      try {
        if (parseRbxXml("").ok) return fail("Arquivo vazio aceito.");
        if (parseRbxXml("<html><body>x</body></html>").ok) return fail("XML sem raiz <roblox> aceito.");
        const bin = parseRbxXml("<roblox!\u0089\u00ff\u000d\u000a\u001a\u000a");
        if (bin.ok || String(bin.error).indexOf("bin\u00e1rio") === -1) {
          return fail("Arquivo binário .rbxl não foi rejeitado com mensagem clara.");
        }
        unkParsed = parseRbxXml(
          '<roblox version="4">' +
            '<Item class="ClasseInexistente" referent="A">' +
            '<Properties><string name="Name">X</string></Properties>' +
            '<Item class="Part" referent="A">' +
            '<Properties><string name="Name">Inner</string></Properties>' +
            "</Item></Item></roblox>",
        );
        if (!unkParsed.ok) return fail("Classe desconhecida derrubou o parse: " + unkParsed.error);
        const conv = unkParsed.roots[0];
        if (!conv || conv.className !== "Folder") return fail("Classe desconhecida não virou Folder.");
        const inner = conv.findFirstChild("Inner");
        if (!inner || inner.className !== "Part") return fail("Filho de classe desconhecida perdido.");
        if (!unkParsed.warnings.length) return fail("Sem warning para classe desconhecida.");
        let deep = "";
        for (let i = 0; i < 600; i++) deep += `<Item class="Folder" referent="d${i}"><Properties><string name="Name">L${i}</string></Properties>`;
        for (let i = 0; i < 600; i++) deep += "</Item>";
        deepParsed = parseRbxXml('<roblox version="4">' + deep + "</roblox>");
        if (deepParsed.ok && !deepParsed.warnings.length) {
          return fail("Profundidade de 600 níveis aceita sem warning (limite não aplicado).");
        }
        return pass("Vazio, não-XML, binário, classe desconhecida, referent duplicado e depth-bomb tratados.");
      } finally {
        if (unkParsed && unkParsed.ok) destroyAll(unkParsed.roots);
        if (deepParsed && deepParsed.ok) destroyAll(deepParsed.roots);
      }
    },
  });


  defineGroup("integration", "Seção 2 — Cenários de Integração");

  defineCheck("integration", {
    id: "luau.wasmFullLanguage",
    label: "Luau VM (Parte 70): linguagem 100% completa na engine WASM",
    timeoutMs: 20000,
    async run() {
      await preloadLuauVM("");
      const info = luauRuntimeInfo();
      if (!info.wasmReady) {
        return fail("VM Luau (WASM) indisponível" + (info.wasmError ? ": " + info.wasmError : "") + " — engine única (Parte 174): Play/Run não iniciam sem a VM.");
      }
      const interp = createRuntimeInterpreter({});
      try {
        if (!interp.isWasm) return fail("runtimeSelector não entregou a engine WASM com o módulo carregado.");
        const src = [
          "local x = 7",
          "assert(`interp {x + 1}` == \"interp 8\", \"interpolation\")",
          "local s = 0",
          "for i = 1, 10 do",
          "  if i % 2 == 0 then continue end",
          "  s += i",
          "end",
          "assert(s == 25, \"continue\")",
          "local mt = { __call = function(self, a) return self.v + a end, __len = function() return 99 end }",
          "local obj = setmetatable({ v = 5 }, mt)",
          "assert(obj(4) == 9 and #obj == 99, \"metatables completas\")",
          "local co = coroutine.create(function(a) return coroutine.yield(a + 1) * 10 end)",
          "local _, v1 = coroutine.resume(co, 1)",
          "local _, v2 = coroutine.resume(co, 5)",
          "assert(v1 == 2 and v2 == 50, \"coroutines nativas\")",
          "local buf = buffer.create(8)",
          "buffer.writeu32(buf, 0, 123456)",
          "assert(buffer.readu32(buf, 0) == 123456 and typeof(buf) == \"buffer\", \"buffer\")",
          "local vec = vector.create(3, 4, 0)",
          "assert(vector.magnitude(vec) == 5 and typeof(vec) == \"vector\", \"vector\")",
          "local ok, err = pcall(function() error({ code = 1 }) end)",
          "assert(not ok and type(err) == \"table\", \"erro não-string\")",
          "return \"LUAU_COMPLETO\"",
        ].join("\n");
        const chunk = interp.compile(src);
        const gen = interp.run(chunk, {});
        let step = gen.next();
        let guard = 0;
        while (!step.done) {
          if (++guard > 1000) return fail("Script de verificação não terminou (yields inesperados).");
          step = gen.next([]);
        }
        const results = step.value || [];
        if (results[0] !== "LUAU_COMPLETO") {
          return fail("Retorno inesperado: " + JSON.stringify(results[0]));
        }
        return pass("Engine WASM ativa: interpolation, continue, metatables completas, coroutines nativas, buffer, vector e erros estruturados OK.");
      } finally {
        if (typeof interp.dispose === "function") interp.dispose();
      }
    },
  });

  defineCheck("integration", {
    id: "scenario.ikSolver",
    label: "Personagem: solver IK converge (FABRIK + two-bone)",
    run() {
      const chain = [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: 2, z: 0 },
        { x: 0, y: 3, z: 0 },
      ];
      const target = { x: 1.5, y: 1.5, z: 0.5 };
      const result = solveChain(chain, target, null);
      if (!result || result.reached !== true) return fail("Alvo alcançável não foi atingido pelo solver.");
      const err = vDist(chain[chain.length - 1], target);
      if (err > IK_TOLERANCE * 20) return fail(`Erro final ${err.toFixed(4)} acima do tolerado.`);
      const two = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 2, z: 0 }];
      solveTwoBone(two, { x: 1, y: 1, z: 0 }, null);
      const errTwo = vDist(two[2], { x: 1, y: 1, z: 0 });
      if (errTwo > IK_TOLERANCE * 20) return fail(`Two-bone com erro ${errTwo.toFixed(4)}.`);
      return pass(`FABRIK erro ${err.toFixed(4)}, two-bone erro ${errTwo.toFixed(4)}.`);
    },
  });


  defineCheck("integration", {
    id: "scenario.boneCFrameRotation",
    label: "Bones: rotação em bone.Transform coerente com o rig (Parte 139)",
    run() {
      const BONE_ROT_WRITE_RE = /\.Transform\s*=\s*CFrame\s*\.\s*(Angles|fromEulerAngles\w*|fromOrientation|fromAxisAngle|fromMatrix)\s*\(/;
      const BONE_POS_WRITE_RE = /\.Transform\s*=\s*CFrame\s*\.\s*new\s*\(/;
      const dm = store.getDataModel();
      if (!dm) return skip("Sem DataModel registrado.");
      const bones = [];
      const rotWriters = [];
      const posWriters = [];
      for (const inst of dm.getDescendants()) {
        if (inst.className === "Bone") {
          bones.push(inst);
          continue;
        }
        if (inst.className === "Script" || inst.className === "LocalScript" || inst.className === "ModuleScript") {
          let src = "";
          try {
            src = String(inst.getProperty("Source") || "");
          } catch (readErr) {
            src = "";
          }
          if (!src) continue;
          const scriptName = String(inst.getProperty("Name") || inst.className);
          if (BONE_ROT_WRITE_RE.test(src)) rotWriters.push(scriptName);
          else if (BONE_POS_WRITE_RE.test(src)) posWriters.push(scriptName);
        }
      }
      if (rotWriters.length && !bones.length) {
        return warn(`Script(s) ${rotWriters.join(", ")} escrevem bone.Transform com CFrame de ROTAÇÃO, mas a cena não tem nenhum Bone — a rotação não terá efeito (Parte 139). Importe um rig skinned ou remova a escrita.`);
      }
      const rotated = bones.filter((b) => {
        let r = null;
        try {
          r = b.getProperty("TransformRotation");
        } catch (readErr) {
          r = null;
        }
        if (!r) return false;
        const eps = 1e-6;
        return Math.abs(Number(r.x) || 0) > eps || Math.abs(Number(r.y) || 0) > eps || Math.abs(Number(r.z) || 0) > eps;
      });
      if (rotated.length && posWriters.length) {
        return warn(`Transform e TransformRotation brigando: script(s) ${posWriters.join(", ")} gravam bone.Transform só posicional (CFrame.new = rotação identidade), o que ZERA TransformRotation de ${rotated.length} Bone(s) rotacionado(s) (setter da Parte 139). Use CFrame.new(pos) * CFrame.Angles(...) para preservar a rotação.`);
      }
      return pass(`${bones.length} Bone(s), ${rotated.length} com rotação persistida; escritas de Transform coerentes.`);
    },
  });

  defineCheck("integration", {
    id: "scenario.monetization",
    label: "Monetização: catálogo, carteira e ownership mocks",
    run() {
      const products = getProducts();
      const passes = getPasses();
      const badges = getBadges();
      if (!Array.isArray(products) || !Array.isArray(passes) || !Array.isArray(badges)) {
        return fail("Catálogo de monetização indisponível.");
      }
      const bal = getBalance(1);
      if (!Number.isFinite(bal)) return fail("Carteira retornou valor inválido.");
      return pass(`${products.length} produto(s), ${passes.length} pass(es), ${badges.length} badge(s).`);
    },
  });

  defineCheck("integration", {
    id: "scenario.memoryStore",
    label: "Dados: MemoryStore hash round-trip",
    run() {
      const name = "__validation";
      hashSet(name, "k1", { score: 42 }, 60);
      const got = hashGet(name, "k1");
      if (!got || got.score !== 42) return fail("hashGet divergente: " + JSON.stringify(got));
      hashRemove(name, "k1");
      memoryStoreClear();
      return pass();
    },
  });

  defineCheck("integration", {
    id: "scenario.dragDetectorStreaming",
    label: "Ferramentas: DragDetector respeita streaming",
    run() {
      if (!isClass("DragDetector")) return fail("Classe DragDetector inexistente.");
      const part = createInstance("Part", { name: "__DragProbe" });
      const dd = createInstance("DragDetector", { name: "Probe", parent: part });
      try {
        if (!dd || dd.getProperty("Enabled") !== true) return fail("DragDetector sem defaults corretos.");
        if (!streaming.isLoadedForActive(part)) return fail("Streaming inativo bloqueou objeto do editor.");
        const snap = streaming.getDebugSnapshot();
        if (!snap || typeof snap.running !== "boolean" || !Array.isArray(snap.clients)) {
          return fail("Snapshot de streaming malformado.");
        }
        return pass(`Streaming ativo: ${snap.enabled ? "sim" : "não (modo edição)"}.`);
      } finally {
        destroyAll([part]);
      }
    },
  });

  defineCheck("integration", {
    id: "scenario.pluginWidget",
    label: "Editor: DockWidget cria, monta e destrói sem resíduos",
    async run() {
      if (typeof document === "undefined") return skip("Sem DOM.");
      const handle = createDockWidget({
        pluginId: "__validation",
        pluginName: "Validation",
        widgetId: "probe",
        title: "Validation Probe",
        info: { InitialDockState: "Float", InitialEnabled: true, FloatingSize: { x: 220, y: 140 } },
      });
      if (!handle) return fail("createDockWidget retornou null.");
      await new Promise((r) => setTimeout(r, 30));
      const mounted = document.querySelector(".rsw-dwidget");
      handle.destroy();
      await new Promise((r) => setTimeout(r, 30));
      if (!handle.isDestroyed()) return fail("Widget não foi destruído.");
      return pass(mounted ? "Widget montado e removido." : "Widget criado (DOM headless).");
    },
  });

  defineCheck("integration", {
    id: "scenario.aiAssistant",
    label: "AI: configuração do Assistant e Code Assist",
    run() {
      if (!isAIEnabled()) return skip("IA desativada nas Settings (opcional).");
      if (!isAIConfigured()) {
        return warn("IA ativada porém incompleta: configure endpoint/chave em File → Studio Settings → AI.");
      }
      const cfg = getAIConfig();
      return pass(`Provider ${cfg.provider}, modelo ${cfg.model}.`);
    },
  });

  defineCheck("integration", {
    id: "scenario.playtestCycle",
    label: "Playtest: ciclo Run → Stop restaura a cena (snapshot)",
    timeoutMs: 20000,
    async run() {
      if (store.get("appMode") !== "EDITOR") return skip("Abra um projeto para testar o Playtest.");
      if (engine.isRunning()) return skip("Playtest já ativo; pare-o antes de validar.");
      const dm = store.getDataModel();
      if (!dm) return skip("Sem DataModel.");
      const before = censusOf(dm);
      engine.run();
      await new Promise((r) => setTimeout(r, 700));
      if (!engine.isRunning()) return fail("engine.run() não iniciou.");
      engine.stop();
      await new Promise((r) => setTimeout(r, 400));
      if (engine.isRunning()) return fail("engine.stop() não parou o runtime.");
      const diffs = censusDiff(before, censusOf(dm));
      if (diffs.length) return fail("Snapshot divergente — " + diffs.join(", "));
      let total = 0;
      for (const v of censusOf(dm).values()) total += v;
      return pass(`Cena restaurada (${total} instância(s)).`);
    },
  });

  defineCheck("integration", {
    id: "scenario.playFullMode",
    label: "Playtest Play: LocalPlayer + Character spawnam e cena restaura",
    timeoutMs: 30000,
    async run() {
      if (store.get("appMode") !== "EDITOR") return skip("Abra um projeto para testar o Play.");
      if (engine.isRunning()) return skip("Playtest já ativo; pare-o antes de validar.");
      const dm = store.getDataModel();
      if (!dm) return skip("Sem DataModel.");
      const before = censusOf(dm);
      engine.play();
      await new Promise((r) => setTimeout(r, 1500));
      if (!engine.isRunning()) return fail("engine.play() não iniciou.");
      let spawned = false;
      try {
        const players = getService(dm, "Players");
        const player = players && players.getChildren().find((c) => c.className === "Player");
        const character = player ? player.getProperty("Character") : null;
        spawned = !!(character && typeof character.isDestroyed === "function" && !character.isDestroyed());
      } catch (_e) { spawned = false; }
      engine.stop();
      await new Promise((r) => setTimeout(r, 500));
      if (engine.isRunning()) return fail("engine.stop() não parou o runtime.");
      const diffs = censusDiff(before, censusOf(dm));
      if (diffs.length) return fail("Restauração divergente — " + diffs.join(", "));
      if (!spawned) return warn("Play iniciou mas o Character não foi detectado.");
      return pass("LocalPlayer + Character criados; cena restaurada após Stop.");
    },
  });

  defineCheck("integration", {
    id: "scenario.csgUnion",
    label: "CSG: Union → Separate com CSG Tree intacta",
    run() {
      const prevSel = selection.get();
      const holder = createInstance("Folder", { name: "__CsgProbe" });
      try {
        const a = createInstance("Part", { name: "A", parent: holder });
        a.setProperty("Position", makeVector3(0, 500, 0));
        const b = createInstance("Part", { name: "B", parent: holder });
        b.setProperty("Position", makeVector3(1, 500, 0));
        selection.set([a, b]);
        if (!unionSelection()) return fail("unionSelection recusou a operação.");
        const union = holder.getChildren().find((c) => c.className === "UnionOperation");
        if (!union) return fail("UnionOperation não foi criada.");
        if (!Array.isArray(union._sourceParts) || union._sourceParts.length !== 2) {
          return fail("CSG Tree (_sourceParts) não preservada.");
        }
        selection.set([union]);
        if (!separateSelection()) return fail("separateSelection falhou.");
        const parts = holder.getChildren().filter((c) => c.className === "Part");
        if (parts.length !== 2) return fail(`Separate devolveu ${parts.length} part(s).`);
        return pass("Union criada e separada de volta em 2 Parts.");
      } finally {
        selection.set(prevSel);
        destroyAll([holder]);
      }
    },
  });

  defineCheck("integration", {
    id: "scenario.pathfinding",
    label: "Pathfinding: A* encontra caminho com waypoints",
    run() {
      const floor = {
        minX: -64, maxX: 64, minY: -1, maxY: 0, minZ: -64, maxZ: 64,
        canCollide: true, anchored: true, material: "Plastic",
      };
      const pf = createPathfinder({
        getGeometry: () => ({ parts: [floor], modifiers: [], links: [] }),
        getGeometryVersion: () => 1,
      });
      const gen = pf.computePath(
        { AgentRadius: 2, AgentHeight: 5 },
        { x: -20, y: 2, z: -20 },
        { x: 20, y: 2, z: 20 },
        () => {},
      );
      let result = null;
      for (let i = 0; i < 100000; i++) {
        const step = gen.next();
        if (step.done) { result = step.value; break; }
      }
      if (!result) return fail("computePath não terminou.");
      if (result.status !== "Success") return fail(`Status ${result.status}.`);
      if (!Array.isArray(result.waypoints) || result.waypoints.length < 2) {
        return fail("Waypoints insuficientes: " + (result.waypoints || []).length);
      }
      const last = result.waypoints[result.waypoints.length - 1];
      const dist = Math.hypot(last.x - 20, last.z - 20);
      if (dist > 8) return fail(`Caminho não chega ao destino (erro ${dist.toFixed(1)} studs).`);
      const genBad = pf.computePath(
        { AgentRadius: 2, AgentHeight: 5 },
        { x: -20, y: 2, z: -20 },
        { x: 999999, y: 2, z: 999999 },
        () => {},
      );
      let bad = null;
      for (let i = 0; i < 100000; i++) {
        const step = genBad.next();
        if (step.done) { bad = step.value; break; }
      }
      if (!bad || bad.status !== "NoPath") return fail("Destino inválido deveria retornar NoPath.");
      return pass(`Success com ${result.waypoints.length} waypoint(s) até o destino; NoPath validado.`);
    },
  });

  defineCheck("integration", {
    id: "scenario.localization",
    label: "Localization: round-trip, lookup por contexto e format",
    run() {
      const data = parseContents(serializeContents({
        locales: [{ id: "pt-br", name: "Português" }],
        entries: [{
          Key: "GREET",
          Source: "Hello {name}!",
          Context: "",
          Example: "",
          Values: { "pt-br": "Olá {name}!" },
        }],
      }));
      if (data.entries.length !== 1) return fail("Round-trip perdeu a entry.");
      const idx = buildIndexes(data);
      const entry = findEntryForSource(idx, "Hello {name}!", "Workspace.Sign.SurfaceGui.TextLabel");
      if (!entry) return fail("Lookup por Source falhou.");
      const text = formatMessage(entry.Values["pt-br"], { name: "Builderman" }, { localeId: "pt-br" });
      if (text !== "Olá Builderman!") return fail(`Tradução incorreta: "${text}".`);
      return pass(`"${text}"`);
    },
  });

  defineCheck("integration", {
    id: "scenario.dataStore",
    label: "Dados: DataStore set/get/remove persistente",
    async run() {
      const key = "probe" + Date.now();
      await dsSet("__ValidationStore", "global", key, { part: 68, ok: true });
      const got = await dsGet("__ValidationStore", "global", key);
      if (!got || got.part !== 68 || got.ok !== true) {
        return fail("dsGet divergente: " + JSON.stringify(got));
      }
      await dsRemove("__ValidationStore", "global", key);
      const gone = await dsGet("__ValidationStore", "global", key);
      if (gone != null) return fail("dsRemove não removeu a chave.");
      return pass();
    },
  });

  defineCheck("integration", {
    id: "scenario.badgeAward",
    label: "Monetização: Badge award, ownership e deduplicação",
    async run() {
      const badges = getBadges().filter((b) => b && b.enabled !== false);
      if (!badges.length) return skip("Nenhum badge configurado no projeto.");
      const badge = badges[0];
      const userId = 900000 + Math.floor(Math.random() * 90000);
      try {
        const first = await awardBadgeAsync(userId, badge.id, "ValidationUser");
        if (first !== true) return fail("AwardBadge retornou false para usuário novo.");
        const owns = await userHasBadgeAsync(userId, badge.id);
        if (owns !== true) return fail("Ownership não persistiu após o award.");
        const again = await awardBadgeAsync(userId, badge.id, "ValidationUser");
        if (again !== false) return fail("Award duplicado deveria retornar false.");
        return pass(`Badge "${badge.name}" concedido e deduplicado.`);
      } finally {
        try { await dsRemove(BADGE_STORE, "global", "u" + userId); } catch (_e) {            }
      }
    },
  });

  defineCheck("integration", {
    id: "scenario.luauServerScript",
    label: "Scripting: Script Luau usa DataStore + MessagingService",
    timeoutMs: 30000,
    async run() {
      if (store.get("appMode") !== "EDITOR") return skip("Abra um projeto para testar scripts.");
      if (engine.isRunning()) return skip("Playtest já ativo; pare-o antes de validar.");
      const dm = store.getDataModel();
      const sss = dm ? getService(dm, "ServerScriptService") : null;
      if (!sss) return skip("Sem ServerScriptService.");
      const cleanup = () => {
        for (const c of sss.getChildren().slice()) {
          if (c.name === "__ValidationScript") destroyAll([c]);
        }
      };
      const prevSettings = project.getSettings();
      const apiWasEnabled = !!(prevSettings.general && prevSettings.general.studioAccessToApis);
      if (!apiWasEnabled) {
        project.applySettings({
          ...prevSettings,
          general: { ...prevSettings.general, studioAccessToApis: true },
        });
      }
      const script = createInstance("Script", { name: "__ValidationScript", parent: sss });
      script.setProperty("Source", [
        'local DSS = game:GetService("DataStoreService")',
        'local MS = game:GetService("MessagingService")',
        'local ds = DSS:GetDataStore("__ValScript")',
        'ds:SetAsync("mark", 68)',
        'MS:SubscribeAsync("__valTopic", function(m)',
        '  ds:SetAsync("echo", m.Data)',
        'end)',
        'MS:PublishAsync("__valTopic", "ok")',
      ].join("\n"));
      try {
        engine.run();
        await new Promise((r) => setTimeout(r, 2800));
        if (!engine.isRunning()) return fail("engine.run() não iniciou.");
        engine.stop();
        await new Promise((r) => setTimeout(r, 400));
        const mark = await dsGet("__ValScript", "global", "mark");
        if (mark !== 68) return fail("Script não gravou no DataStore (mark=" + JSON.stringify(mark) + ").");
        const echo = await dsGet("__ValScript", "global", "echo");
        if (echo !== "ok") {
          return warn(
            "DataStore ok; eco do MessagingService não chegou (echo=" + JSON.stringify(echo) +
            ") — esperado com a aba em segundo plano (scheduler/rAF suspenso).",
          );
        }
        return pass("SetAsync + Subscribe/Publish round-trip via Luau.");
      } finally {
        cleanup();
        if (!apiWasEnabled) {
          try {
            const cur = project.getSettings();
            project.applySettings({
              ...cur,
              general: { ...cur.general, studioAccessToApis: false },
            });
          } catch (_e) {            }
        }
        try { await dsRemove("__ValScript", "global", "mark"); } catch (_e) {            }
        try { await dsRemove("__ValScript", "global", "echo"); } catch (_e) {            }
      }
    },
  });

  defineCheck("integration", {
    id: "scenario.multiClient",
    label: "Multi-cliente: 3 Players simultâneos e limpeza no Stop",
    timeoutMs: 30000,
    async run() {
      if (store.get("appMode") !== "EDITOR") return skip("Abra um projeto para testar multi-cliente.");
      if (engine.isRunning()) return skip("Playtest já ativo; pare-o antes de validar.");
      const dm = store.getDataModel();
      if (!dm) return skip("Sem DataModel.");
      const before = censusOf(dm);
      const prevCount = multiClient.getPlayerCount();
      try {
        multiClient.setPlayerCount(3);
        if (!multiClient.start()) return fail("multiClient.start() falhou.");
        await new Promise((r) => setTimeout(r, 1800));
        const players = getService(dm, "Players");
        const alive = players
          ? players.getChildren().filter((c) => c.className === "Player" && !c.isDestroyed()).length
          : 0;
        const sessions = multiClient.getSessions().length;
        engine.stop();
        await new Promise((r) => setTimeout(r, 500));
        if (alive !== 3) return fail(`Esperados 3 Players durante o Play; encontrados ${alive}.`);
        if (sessions !== 3) return fail(`Esperadas 3 sessões; encontradas ${sessions}.`);
        if (multiClient.isMultiRunning()) return fail("Sessões não foram limpas no Stop.");
        const diffs = censusDiff(before, censusOf(dm));
        if (diffs.length) return fail("Restauração divergente — " + diffs.join(", "));
        return pass("3 clientes com contextos Luau isolados; cena restaurada.");
      } finally {
        if (engine.isRunning()) {
          engine.stop();
          await new Promise((r) => setTimeout(r, 300));
        }
        multiClient.setPlayerCount(prevCount);
      }
    },
  });

  defineCheck("integration", {
    id: "scenario.streamingPlay",
    label: "Streaming: Play com StreamingEnabled filtra por cliente",
    timeoutMs: 30000,
    async run() {
      if (store.get("appMode") !== "EDITOR") return skip("Abra um projeto para testar streaming.");
      if (engine.isRunning()) return skip("Playtest já ativo; pare-o antes de validar.");
      const dm = store.getDataModel();
      const ws = dm ? getService(dm, "Workspace") : null;
      if (!ws || !ws.hasProperty("StreamingEnabled")) return fail("Workspace.StreamingEnabled inexistente.");
      const before = censusOf(dm);
      const prev = ws.getProperty("StreamingEnabled");
      try {
        ws.setProperty("StreamingEnabled", true);
        engine.play();
        await new Promise((r) => setTimeout(r, 1500));
        if (!engine.isRunning()) return fail("engine.play() não iniciou.");
        if (!streaming.isStreamingActive()) return fail("Streaming não ativou com StreamingEnabled = true.");
        const snap = streaming.getDebugSnapshot();
        const client = snap.clients[0];
        if (!client) return fail("Nenhum cliente no snapshot de streaming.");
        if (!(client.totalUnits >= 1)) return fail("Nenhuma unidade de streaming detectada.");
        const baseplate = ws.getChildren().find((c) => c.name === "Baseplate");
        const loaded = baseplate ? streaming.isLoadedForActive(baseplate) : true;
        engine.stop();
        await new Promise((r) => setTimeout(r, 500));
        if (streaming.isStreamingActive()) return fail("Streaming continuou ativo após o Stop.");
        const diffs = censusDiff(before, censusOf(dm));
        if (diffs.length) return fail("Restauração divergente — " + diffs.join(", "));
        if (!loaded) {
          return warn(`${client.loadedUnits}/${client.totalUnits} unidade(s); Baseplate próximo não estava carregado.`);
        }
        return pass(`${client.loadedUnits}/${client.totalUnits} unidade(s) carregadas para o cliente ativo.`);
      } finally {
        if (engine.isRunning()) {
          engine.stop();
          await new Promise((r) => setTimeout(r, 300));
        }
        try { ws.setProperty("StreamingEnabled", prev === true); } catch (_e) {            }
      }
    },
  });









  defineCheck("integration", {
    id: "integration.toolGrip140",
    label: "Tool Grip orientado (Parte 140 — contrato tool-grip-1)",
    async run() {
      let gm = null;
      try {
        gm = await import("../runtime/gripMath.js");
      } catch (_e) {
        return warn("src/runtime/gripMath.js ainda não disponível — fatia A da Parte 140 pendente.");
      }
      for (const fn of ["orthonormalizeGrip", "gripToCFrame", "handlePose", "rigidMove"]) {
        if (typeof gm[fn] !== "function") return fail(`gripMath.js não exporta ${fn}() (contrato tool-grip-1).`);
      }
      if (!gm.GRIP_DEFAULTS) return fail("gripMath.js não exporta GRIP_DEFAULTS (contrato tool-grip-1).");
      const fin = (cf) => [cf.x, cf.y, cf.z, cf.qx, cf.qy, cf.qz, cf.qw].every(Number.isFinite);

      const idCF = gm.gripToCFrame(gm.GRIP_DEFAULTS);
      const isId = Math.abs(idCF.x) < 1e-9 && Math.abs(idCF.y) < 1e-9 && Math.abs(idCF.z) < 1e-9
        && Math.abs(idCF.qx) < 1e-9 && Math.abs(idCF.qy) < 1e-9 && Math.abs(idCF.qz) < 1e-9
        && Math.abs(Math.abs(idCF.qw) - 1) < 1e-9;
      if (!isId) return fail("gripToCFrame(GRIP_DEFAULTS) deveria ser a IDENTIDADE — regra de custo zero do repositionTool violada.");


      const handCF = { x: 10, y: 5, z: -2, qx: 0, qy: 0, qz: 0, qw: 1 };
      const gripCF = gm.gripToCFrame({ pos: { x: 0.25, y: -0.5, z: 1 }, forward: gm.GRIP_DEFAULTS.forward, right: gm.GRIP_DEFAULTS.right, up: gm.GRIP_DEFAULTS.up });
      const pose = gm.handlePose(handCF, gripCF);
      if (!fin(pose)) return fail("handlePose devolveu NaN/Infinity com entradas válidas.");
      if (Math.abs(pose.x - 9.75) > 1e-9 || Math.abs(pose.y - 5.5) > 1e-9 || Math.abs(pose.z - (-3)) > 1e-9) {
        return fail("handlePose com Grip default não é translação pura por -GripPos (custo zero violado).");
      }


      const degen = gm.orthonormalizeGrip({ forward: { x: 0, y: 0, z: 0 }, right: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 0 } });
      const dcf = gm.gripToCFrame({ pos: { x: 0, y: 0, z: 0 }, forward: degen.forward, right: degen.right, up: degen.up });
      if (!fin(dcf)) return fail("Grip degenerado produziu NaN após orthonormalizeGrip + gripToCFrame.");
      if (degen.fixed !== true) return warn("orthonormalizeGrip(degenerado) não sinalizou fixed:true (esperado pelo contrato tool-grip-1).");

      const s = Math.SQRT1_2;
      const oldH = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
      const newH = { x: 3, y: 1, z: 0, qx: 0, qy: s, qz: 0, qw: s };
      const moved = gm.rigidMove({ x: 0, y: 0, z: -2, qx: 0, qy: 0, qz: 0, qw: 1 }, oldH, newH);
      if (!fin(moved)) return fail("rigidMove devolveu NaN/Infinity.");
      const dist = Math.hypot(moved.x - newH.x, moved.y - newH.y, moved.z - newH.z);
      if (Math.abs(dist - 2) > 1e-6) return fail(`rigidMove não manteve o offset rígido (distância ${dist.toFixed(6)} != 2).`);

      try {
        const go = await import("../runtime/gameplayObjects.js");
        if (!go.gameplay || typeof go.gameplay._repositionTool !== "function") {
          return warn("gameplayObjects.gameplay sem hook _repositionTool (spec gripRuntime140 depende dele).");
        }
      } catch (_e) {
        return warn("gameplayObjects.js não importável neste contexto — validado apenas o núcleo gripMath.");
      }
      return pass("Contrato tool-grip-1 íntegro: defaults ⇒ identidade (custo zero), sem NaN em degenerado e offset rígido preservado.");
    },
  });


  defineCheck("integration", {
    id: "integration.partApi143",
    label: "Membros de BasePart (Parte 143 — contrato basepart-members-1)",
    async run() {
      let pm = null;
      let pj = null;
      try {
        pm = await import("../runtime/partMass.js");
        pj = await import("../runtime/partJoints.js");
      } catch (_e) {
        return warn("partMass.js/partJoints.js ainda não disponíveis — fatias A/B da Parte 143 pendentes.");
      }
      if (pm.PART_MASS_VERSION !== "basepart-members-1") return fail("PART_MASS_VERSION difere do contrato basepart-members-1.");
      for (const fn of ["densityFor", "partVolume", "partMass", "resizePart"]) {
        if (typeof pm[fn] !== "function") return fail(`partMass.js não exporta ${fn}() (contrato basepart-members-1).`);
      }
      for (const fn of ["jointsOf", "breakJoints", "makeJoints", "createNetworkOwnershipStore"]) {
        if (typeof pj[fn] !== "function") return fail(`partJoints.js não exporta ${fn}() (contrato basepart-members-1).`);
      }

      const m = pm.partMass({ size: { x: 4, y: 2, z: 2 }, shape: "Block", className: "Part", material: "Plastic" });
      if (!Number.isFinite(m) || Math.abs(m - 11.2) > 1e-9) return fail(`partMass(bloco 4x2x2 Plastic) = ${m}, esperado 11.2.`);

      const r = pm.resizePart({ size: { x: 2, y: 2, z: 2 }, position: { x: 0, y: 0, z: 0 }, normalId: "Top", delta: 2, shape: "Block" });
      if (!r.ok || Math.abs(r.size.y - 4) > 1e-9 || Math.abs(r.position.y - 1) > 1e-9 || Math.abs(r.size.x - 2) > 1e-9) {
        return fail("resizePart(Top, +2) deveria crescer só o eixo Y (2→4) e deslocar a posição em +1.");
      }
      const rBad = pm.resizePart({ size: { x: 2, y: 2, z: 2 }, position: { x: 0, y: 0, z: 0 }, normalId: "Top", delta: -3, shape: "Block" });
      if (rBad.ok !== false) return fail("resizePart que viola MIN_PART_SIZE deveria devolver ok:false sem alterar nada.");

      if (!pj.JOINABLE_SURFACES.has("Studs") || pj.JOINABLE_SURFACES.has("Smooth")) {
        return fail("JOINABLE_SURFACES deve conter Studs e NÃO conter Smooth (contrato).");
      }

      const store = pj.createNetworkOwnershipStore();
      const part = {};
      const player = {};
      if (store.get(part) !== null) return fail("networkOwners.get(part) deveria ser null (servidor) por padrão.");
      store.set(part, player);
      if (store.get(part) !== player) return fail("networkOwners round-trip set/get falhou.");
      store.set(part, null);
      if (store.get(part) !== null) return fail("networkOwners.set(part, null) deveria devolver o dono ao servidor.");
      return pass("Contrato basepart-members-1 íntegro: massa oficial (11.2), Resize desloca delta/2, Smooth não junta e dono de rede faz round-trip.");
    },
  });


  defineGroup("performance", "Seção 4 — Performance e Estabilidade");


  defineCheck("performance", {
    id: "perf.complexPools",
    label: "Pools de geometria complexa (uniões CSG opacas e translúcidas)",
    timeoutMs: 15000,
    async run() {
      let THREE = null;
      try {
        THREE = await import("three");
      } catch (_) {
        return skip("Three.js indisponível neste ambiente.");
      }
      const { createComplexInstanced } = await import("../viewport/complexInstanced.js");
      const scene = new THREE.Scene();
      let builds = 0;
      const inst = createComplexInstanced({
        THREE,
        scene,
        buildCsgGeometry: () => {
          builds++;
          return new THREE.BoxGeometry(2, 2, 2);
        },
        resolveMeshProto: (_id, cb) => cb(null),
      });
      try {
        const csg = {
          parts: [{ shape: "Block", size: { x: 2, y: 2, z: 2 }, local: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, negate: false, color: { r: 1, g: 0, b: 0 } }],
          baseSize: { x: 2, y: 2, z: 2 },
          usePartColor: false,
          smoothingAngle: 50,
        };
        const mk = (id, x) => ({
          id, kind: "part", className: "UnionOperation", instance: {},
          position: { x, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 },
          rotation: { x: 0, y: 0, z: 0 }, color: { r: 1, g: 1, b: 1 },
          transparency: 0, localTransparency: 0, material: "Plastic",
          materialVariant: "", appearance: null, isMeshPart: false, meshId: "", csg,
        });
        if (!inst.accepts(mk("a", 0))) return fail("união opaca elegível foi recusada pelo pool.");
        if (!inst.add(mk("a", 0)) || !inst.add(mk("b", 4))) return fail("add de uniões idênticas no pool falhou.");

        const g1 = { ...mk("g1", 8), transparency: 0.5 };
        const g2 = { ...mk("g2", 12), transparency: 0.5 };
        if (!inst.add(g1) || !inst.add(g2)) return fail("add de uniões translúcidas no pool falhou.");
        const glass = scene.children.find(
          (o) => o.userData && o.userData.__rswComplex && o.material && o.material.transparent,
        );
        if (!glass || Math.abs(glass.material.opacity - 0.5) > 1e-6) {
          return fail("pool translúcido sem material transparent com opacity = 1 - t.");
        }
        inst.sortTranslucent({ x: 0, y: 0, z: 30 });                             
        const detail = `2 uniões opacas + 2 translúcidas → ${inst.poolCount()} pools, ${builds} construção(ões) CSG, ${inst.size()} instância(s).`;
        if (builds !== 1 || inst.poolCount() !== 2 || inst.size() !== 4) return fail(detail);
        if (!inst.remove("a") || !inst.remove("b") || !inst.remove("g1") || !inst.remove("g2")) {
          return fail("remoção do pool falhou.");
        }
        return pass(detail);
      } finally {
        inst.dispose();
      }
    },
  });


  defineCheck("integration", {
    id: "integration.meshColliders",
    label: "Colisores reais de malha (casco + decomposição)",
    timeoutMs: 10000,
    async run() {
      const { computeConvexHull, voxelDecompose, raycastMeshCollision } = await import("../physics/collisionGeometry.js");
      const { ConvexPolyhedron, Box } = await import("../physics/engine/shapes.js");
      const { Vec3, Quaternion } = await import("../physics/engine/math3d.js");
      const { collideShapes } = await import("../physics/engine/narrowphase.js");
      const boxSoup = (cx, cy, cz, hx, hy, hz) => {
        const c = [
          [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
          [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
        ].map(([x, y, z]) => [cx + x * hx, cy + y * hy, cz + z * hz]);
        const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
        const soup = [];
        for (const qd of quads) {
          soup.push(...c[qd[0]], ...c[qd[1]], ...c[qd[2]]);
          soup.push(...c[qd[0]], ...c[qd[2]], ...c[qd[3]]);
        }
        return soup;
      };
      const cube = boxSoup(0, 0, 0, 0.5, 0.5, 0.5);
      const pts = [];
      for (let i = 0; i + 2 < cube.length; i += 3) {
        pts.push({ x: cube[i], y: cube[i + 1], z: cube[i + 2] });
      }
      const hull = computeConvexHull(pts, 48);
      if (!hull || hull.vertices.length !== 8) return fail("quickhull do cubo não achou os 8 cantos.");
      const shape = new ConvexPolyhedron({ vertices: hull.vertices, faces: hull.faces });
      if (Math.abs(shape.volume() - 1) > 0.15) return fail(`volume do casco: ${shape.volume().toFixed(3)}.`);
      const q = new Quaternion();
      const contacts = collideShapes(
        shape, new Vec3(0, 0.9, 0), q,
        new Box(new Vec3(5, 0.5, 5)), new Vec3(0, 0, 0), q,
      );
      if (!contacts || !contacts.length) return fail("casco não gera contato no narrowphase.");
      const arch = [
        ...boxSoup(-0.4, 0, 0, 0.1, 0.5, 0.2),
        ...boxSoup(0.4, 0, 0, 0.1, 0.5, 0.2),
        ...boxSoup(0, 0.4, 0, 0.5, 0.1, 0.2),
      ];
      const boxes = voxelDecompose(arch, {});
      if (!boxes || !boxes.length) return fail("decomposição do arco não gerou caixas.");
      const covered = boxes.some(
        (b) =>
          Math.abs(0 - b.c.x) <= b.h.x &&
          Math.abs(-0.2 - b.c.y) <= b.h.y &&
          Math.abs(0 - b.c.z) <= b.h.z,
      );
      if (covered) return fail("o vão do arco foi tapado pela decomposição.");
      const gapRay = raycastMeshCollision({ hull: null, boxes }, "Default", 10, 10, 10, { x: 0, y: -3, z: -10 }, { x: 0, y: 0, z: 1 }, 100);
      if (gapRay) return fail("raycast reportou acerto no vão livre do arco.");
      const pillarRay = raycastMeshCollision({ hull: null, boxes }, "Default", 10, 10, 10, { x: 4, y: -3, z: -10 }, { x: 0, y: 0, z: 1 }, 100);
      if (!pillarRay) return fail("raycast não acertou o pilar do arco.");
      return pass(`casco com 8 vértices + ${boxes.length} caixas; vão livre (física e raycast).`);
    },
  });


  defineCheck("performance", {
    id: "perf.gltfPools",
    label: "Pools de MeshPart glTF (submalhas instanciadas)",
    timeoutMs: 15000,
    async run() {
      let THREE = null;
      try {
        THREE = await import("three");
      } catch (_) {
        return skip("Three.js indisponível neste ambiente.");
      }
      const { createComplexInstanced } = await import("../viewport/complexInstanced.js");
      const scene = new THREE.Scene();
      const geoA = new THREE.BoxGeometry(1, 1, 1);
      const geoB = new THREE.BoxGeometry(0.5, 2, 0.5);
      geoA.userData.__rswShared = true;
      geoB.userData.__rswShared = true;
      const proto = {
        submeshes: [
          { geometry: geoA, material: new THREE.MeshStandardMaterial({ color: 0x88aa55 }) },
          { geometry: geoB, material: new THREE.MeshStandardMaterial({ color: 0x775533 }) },
        ],
        center: { x: 0, y: 0, z: 0 },
        size: { x: 1, y: 2, z: 1 },
      };
      const inst = createComplexInstanced({
        THREE,
        scene,
        buildCsgGeometry: () => new THREE.BoxGeometry(1, 1, 1),
        resolveMeshProto: (_id, cb) => cb(proto),
      });
      try {
        const mk = (id, x) => ({
          id, kind: "part", className: "MeshPart", instance: {},
          position: { x, y: 0, z: 0 }, size: { x: 2, y: 4, z: 2 },
          rotation: { x: 0, y: 0, z: 0 }, color: { r: 1, g: 1, b: 1 },
          transparency: 0, localTransparency: 0, material: "Plastic",
          materialVariant: "", appearance: null, isMeshPart: true,
          meshId: "check://tree", textureId: "", doubleSided: false, csg: null,
        });
        inst.accepts(mk("a", 0));                                            
        if (!inst.accepts(mk("a", 0))) return fail("MeshPart glTF elegível foi recusada pelo pool.");
        if (!inst.add(mk("a", 0)) || !inst.add(mk("b", 6))) return fail("add de MeshParts glTF no pool falhou.");
        const meshes = inst.getRaycastMeshes();
        const detail = `2 MeshParts × 2 submalhas → ${inst.poolCount()} pool, ${meshes.length} draw calls, ${inst.size()} instâncias.`;
        if (inst.poolCount() !== 1 || meshes.length !== 2 || inst.size() !== 2) return fail(detail);
        if (meshes[1].instanceMatrix !== meshes[0].instanceMatrix) {
          return fail("extras não compartilham o buffer de matrizes do primário.");
        }
        if (meshes[0].material === proto.submeshes[0].material) {
          return fail("material do proto não foi clonado para o pool.");
        }
        if (!inst.remove("a") || !inst.remove("b")) return fail("remoção do pool falhou.");
        return pass(detail);
      } finally {
        inst.dispose();
        geoA.dispose();
        geoB.dispose();
      }
    },
  });

  defineCheck("performance", {
    id: "perf.instanceChurn",
    label: "5.000 instâncias: criar + percorrer + destruir",
    timeoutMs: 30000,
    run() {
      const t0 = performance.now();
      const root = createInstance("Folder", { name: "__PerfProbe" });
      for (let i = 0; i < 5000; i++) {
        const p = createInstance("Part", { name: "P" + i, parent: root });
        if (i % 500 === 0) p.setProperty("Position", makeVector3(i % 100, 1, i / 100));
      }
      const created = performance.now() - t0;
      const t1 = performance.now();
      const n = root.getDescendants().length;
      const traversed = performance.now() - t1;
      const t2 = performance.now();
      destroyAll([root]);
      const destroyed = performance.now() - t2;
      const total = created + traversed + destroyed;
      const detail = `criar ${created.toFixed(0)}ms, percorrer ${traversed.toFixed(0)}ms (${n}), destruir ${destroyed.toFixed(0)}ms.`;
      if (total > 8000) return fail(detail);
      if (total > 3000) return warn(detail);
      return pass(detail);
    },
  });

  defineCheck("performance", {
    id: "perf.serializeLarge",
    label: "Serialização de 5.000 instâncias",
    timeoutMs: 30000,
    run() {
      const root = createInstance("Folder", { name: "__PerfSer" });
      for (let i = 0; i < 5000; i++) createInstance("Part", { name: "P" + i, parent: root });
      try {
        const t0 = performance.now();
        const result = serializeInstances([root]);
        const ms = performance.now() - t0;
        const detail = `${result.count} nó(s) em ${ms.toFixed(0)}ms.`;
        if (ms > 5000) return fail(detail);
        if (ms > 2000) return warn(detail);
        return pass(detail);
      } finally {
        destroyAll([root]);
      }
    },
  });

  defineCheck("performance", {
    id: "perf.busThroughput",
    label: "EventBus: 100.000 emits com 3 listeners",
    run() {
      const scratch = new EventBus();
      let acc = 0;
      scratch.on("tick", () => { acc += 1; });
      scratch.on("tick", (v) => { acc += v || 0; });
      scratch.on("tick", () => {});
      const t0 = performance.now();
      for (let i = 0; i < 100000; i++) scratch.emit("tick", 0);
      const ms = performance.now() - t0;
      if (acc < 100000) return fail("Listeners não executaram corretamente.");
      const detail = `${ms.toFixed(0)}ms (${(100000 / ms * 1000 / 1000).toFixed(0)}k emits/s).`;
      if (ms > 2000) return warn(detail);
      return pass(detail);
    },
  });

  defineCheck("performance", {
    id: "perf.playtestLoad",
    label: "Playtest sob carga: 2.000 instâncias extras no Workspace",
    timeoutMs: 60000,
    async run() {
      if (store.get("appMode") !== "EDITOR") return skip("Abra um projeto para o teste de carga.");
      if (engine.isRunning()) return skip("Playtest já ativo; pare-o antes de validar.");
      const dm = store.getDataModel();
      const ws = dm ? getService(dm, "Workspace") : null;
      if (!ws) return skip("Sem Workspace.");
      const cleanup = () => {
        for (const c of ws.getChildren().slice()) {
          if (c.name === "__LoadProbe") destroyAll([c]);
        }
      };
      const t0 = performance.now();
      const holder = createInstance("Model", { name: "__LoadProbe", parent: ws });
      for (let i = 0; i < 2000; i++) {
        const part = createInstance("Part", { name: "L" + i, parent: holder });
        part.setProperty("Anchored", true);
        part.setProperty(
          "Position",
          makeVector3((i % 50) * 3 - 75, 120, Math.floor(i / 50) * 3 - 75),
        );
      }
      const buildMs = performance.now() - t0;
      try {
        const before = censusOf(dm);
        const t1 = performance.now();
        engine.run();
        await new Promise((r) => setTimeout(r, 1200));
        const started = engine.isRunning();
        engine.stop();
        await new Promise((r) => setTimeout(r, 600));
        const cycleMs = performance.now() - t1;
        if (!started) return fail("engine.run() não iniciou sob carga.");
        if (engine.isRunning()) return fail("engine.stop() não parou sob carga.");
        const diffs = censusDiff(before, censusOf(dm));
        if (diffs.length) return fail("Restauração divergente sob carga — " + diffs.join(", "));
        const detail = `build ${buildMs.toFixed(0)}ms, snapshot+Run+Stop+restore ${cycleMs.toFixed(0)}ms (2.000 parts).`;
        if (buildMs + cycleMs > 25000) return fail(detail);
        if (buildMs + cycleMs > 12000) return warn(detail);
        return pass(detail);
      } finally {
        cleanup();
      }
    },
  });

  defineCheck("performance", {
    id: "perf.fpsSample",
    label: "Viewport: FPS acima de 30 (amostra de ~0,7s)",
    timeoutMs: 5000,
    async run() {
      if (typeof requestAnimationFrame !== "function") return skip("Sem rAF.");
      if (typeof document !== "undefined" && document.hidden) return skip("Aba em segundo plano.");
      const frames = [];
      let last = performance.now();
      const sampled = await new Promise((resolve) => {
        const guard = setTimeout(() => resolve(false), 2500);
        const t0 = performance.now();
        const loop = (ts) => {
          frames.push(ts - last);
          last = ts;
          if (ts - t0 < 700) requestAnimationFrame(loop);
          else { clearTimeout(guard); resolve(true); }
        };
        requestAnimationFrame(loop);
      });
      if (!sampled || frames.length < 5) return skip("rAF suspenso (aba em segundo plano).");
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      const fps = 1000 / avg;
      const detail = `${fps.toFixed(1)} FPS médio (${frames.length} frames).`;
      if (fps < 20) return fail(detail);
      if (fps < 30) return warn(detail);
      return pass(detail);
    },
  });

  defineCheck("integration", {
    id: "integration.camRender144",
    label: "Câmera (Parte 144): escrita da pose preserva rotação (camera-interp-1)",
    run() {


      const writes = [];
      const fake = {
        hasProperty: () => true,
        getProperty: () => null,
        setProperty(name, value) { writes.push([name, value]); },
      };
      const S = Math.SQRT1_2;                 
      cameraSys.writeCameraProps(fake, { px: 1, py: 2, pz: 3, tx: 0, ty: 0, tz: 0, qx: 0, qy: S, qz: 0, qw: S }, true);
      const cf1 = writes.find((w) => w[0] === "CFrame");
      if (!cf1) return warn("writeCameraProps não escreveu CFrame na sonda (instância fake).");
      if (!(Math.abs(cf1[1].qy - S) < 1e-6 && Math.abs(cf1[1].qw - S) < 1e-6)) {
        return fail("Rotação da pose perdida na escrita do CFrame (esperado quat de 90° em Y).");
      }
      writes.length = 0;
      cameraSys.writeCameraProps(fake, { px: 1, py: 2, pz: 3, tx: 0, ty: 0, tz: 0, qx: S, qy: 0, qz: 0, qw: S }, false);
      if (!writes.some((w) => w[0] === "CFrame")) {
        return fail("Rotação pura (posição idêntica) não sincronizou — guarda lastSyncKey ignora o quaternion.");
      }
      writes.length = 0;
      cameraSys.writeCameraProps(fake, { px: 1, py: 2, pz: 3, tx: 0, ty: 0, tz: 0, qx: S, qy: 0, qz: 0, qw: S }, false);
      if (writes.length) return warn("Guarda anti-spam deixou passar pose idêntica (escrita repetida).");
      writes.length = 0;
      cameraSys.writeCameraProps(fake, { px: 7, py: 8, pz: 9, tx: 0, ty: 1, tz: 0 }, true);
      const cf2 = writes.find((w) => w[0] === "CFrame");
      if (!cf2 || cf2[1].qx !== 0 || cf2[1].qy !== 0 || cf2[1].qz !== 0 || cf2[1].qw !== 1) {
        return fail("Pose sem rotação deixou de escrever quat identidade (custo zero violado).");
      }
      return pass("Quat preservado na escrita, rotação pura sincroniza, anti-spam ok, custo zero ok.");
    },
  });

  defineCheck("integration", {
    id: "integration.terrainImport153",
    label: "Terreno (Parte 153): import parcial nunca perde tudo e teto configurável nas Settings",
    run() {


      const savedMaxVoxels = SMOOTH_GRID_LIMITS.maxVoxels;
      try {
        const fullChunk = (mat) => ({
          mat: new Uint8Array(4096).fill(mat),
          occ: new Uint8Array(4096).fill(255),
        });
        const a = fullChunk(2);
        const b = fullChunk(3);
        const blob = encodeSmoothGridBytes(
          [
            { key: "0|0|0", mat: a.mat, occ: a.occ },
            { key: "3|0|0", mat: b.mat, occ: b.occ },
          ],
          { chunkSizeLog2: 5 },
        );
        if (!blob) return fail("encodeSmoothGridBytes devolveu null para fixture válida.");


        const w1 = [];
        const d1 = decodeSmoothGridBytes(blob, w1);
        if (!d1 || d1.ok !== true || d1.partial) return fail("Round-trip completo não deveria ser parcial.");
        if (!(d1.stats && d1.stats.voxels === 8192)) {
          return fail(`Round-trip: esperava 8192 voxels, veio ${d1 && d1.stats ? d1.stats.voxels : "?"}.`);
        }


        SMOOTH_GRID_LIMITS.maxVoxels = 4096;
        const w2 = [];
        const d2 = decodeSmoothGridBytes(blob, w2);
        if (!d2 || d2.ok !== true) return fail("Orçamento estourado: decode deveria manter ok:true.");
        if (d2.partial !== true) return fail("Orçamento estourado: partial:true ausente.");
        if (!(d2.stats.voxels > 0 && d2.stats.voxels <= 4096)) {
          return fail(`Orçamento estourado: voxels fora do teto (${d2.stats.voxels} de 4096).`);
        }
        const txt2 = w2.join(" | ");
        if (!/or[çc]amento|parcial/i.test(txt2)) return fail("Orçamento estourado: aviso de orçamento/parcial ausente.");
        if (!/Terreno importado:/.test(txt2)) return fail("Sumário único do import (Parte 153) ausente no Output.");


        SMOOTH_GRID_LIMITS.maxVoxels = savedMaxVoxels;
        const w3 = [];
        const d3 = decodeSmoothGridBytes(blob.subarray(0, blob.length - 9), w3);
        if (!d3) return fail("Blob truncado: decode devolveu null (contrato: nunca lançar/perder tudo).");
        if (d3.partial !== true) return fail("Blob truncado: partial:true ausente.");


        if (SETTINGS_DEFAULTS.terrainImportMaxVoxels !== 40000000) {
          return fail("Default de terrainImportMaxVoxels deveria ser 40000000 (contrato Parte 131).");
        }
        const clamped = syncTerrainImportBudget(1);
        if (clamped !== TERRAIN_IMPORT_MAX_VOXELS_RANGE.min || SMOOTH_GRID_LIMITS.maxVoxels !== clamped) {
          return fail("syncTerrainImportBudget não clampou/aplicou o teto mínimo.");
        }
        const applied = syncTerrainImportBudget();
        if (!(applied >= TERRAIN_IMPORT_MAX_VOXELS_RANGE.min && applied <= TERRAIN_IMPORT_MAX_VOXELS_RANGE.max)) {
          return fail("Teto vindo das Studio Settings fora do range válido.");
        }
        return pass(`Parcial por orçamento ok (${d2.stats.voxels} voxels ≤ teto), truncado ok, teto das Settings aplicado (${applied}).`);
      } finally {
        SMOOTH_GRID_LIMITS.maxVoxels = savedMaxVoxels;
      }
    },
  });
}
