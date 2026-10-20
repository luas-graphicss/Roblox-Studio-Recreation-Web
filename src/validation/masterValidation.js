import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";

const DEFAULT_TIMEOUT_MS = 10000;
const STATUSES = new Set(["pass", "warn", "fail", "skip"]);

const groups = new Map();
let running = false;

export function defineGroup(id, label) {
  if (!groups.has(id)) groups.set(id, { id, label, checks: [] });
  return groups.get(id);
}

export function defineCheck(groupId, def) {
  const g = groups.get(groupId);
  if (!g || !def || typeof def.id !== "string" || typeof def.run !== "function") return false;
  if (g.checks.some((c) => c.id === def.id)) return false;
  g.checks.push({
    id: def.id,
    label: typeof def.label === "string" && def.label ? def.label : def.id,
    timeoutMs: Number.isFinite(def.timeoutMs) ? Math.min(def.timeoutMs, 60000) : DEFAULT_TIMEOUT_MS,
    run: def.run,
  });
  return true;
}

function withTimeout(promise, ms, label) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout de ${ms}ms em "${label}"`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function normalizeResult(raw) {
  if (raw && typeof raw === "object" && STATUSES.has(raw.status)) {
    return { status: raw.status, detail: typeof raw.detail === "string" ? raw.detail : "" };
  }
  if (raw === true || raw === undefined) return { status: "pass", detail: "" };
  return { status: "fail", detail: "Resultado inválido retornado pelo check." };
}

export function isValidationRunning() {
  return running;
}

export function listGroups() {
  return [...groups.values()].map((g) => ({
    id: g.id,
    label: g.label,
    checks: g.checks.map((c) => ({ id: c.id, label: c.label })),
  }));
}

export async function runMasterValidation(opts = {}) {
  if (running) return null;
  running = true;
  const only = opts.groupId || null;
  const report = {
    startedAt: new Date().toISOString(),
    durationMs: 0,
    summary: { pass: 0, warn: 0, fail: 0, skip: 0, total: 0 },
    groups: [],
  };
  const t0 = performance.now();
  bus.emit("validation:started", { groups: listGroups().length });
  try {
    for (const g of groups.values()) {
      if (only && g.id !== only) continue;
      const gr = { id: g.id, label: g.label, checks: [] };
      report.groups.push(gr);
      for (const check of g.checks) {
        const c0 = performance.now();
        let result;
        try {
          result = normalizeResult(
            await withTimeout(Promise.resolve(check.run()), check.timeoutMs, check.label),
          );
        } catch (err) {
          result = { status: "fail", detail: (err && err.message) || String(err) };
        }
        const entry = {
          id: check.id,
          label: check.label,
          status: result.status,
          detail: result.detail,
          ms: Math.round(performance.now() - c0),
        };
        gr.checks.push(entry);
        report.summary[result.status] += 1;
        report.summary.total += 1;
        bus.emit("validation:progress", { group: g.id, check: entry, summary: { ...report.summary } });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    running = false;
  }
  report.durationMs = Math.round(performance.now() - t0);
  const s = report.summary;
  logger.info(
    `Validação Mestre concluída: ${s.pass} pass, ${s.warn} warn, ${s.fail} fail, ${s.skip} skip (${report.durationMs}ms).`,
    { source: "Studio" },
  );
  bus.emit("validation:finished", { report });
  return report;
}
