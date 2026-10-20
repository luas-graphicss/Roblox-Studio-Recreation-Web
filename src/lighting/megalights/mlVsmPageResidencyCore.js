export const DEFAULT_MAXIMUM_PAGES_PER_FRAME = 8;

export const PAGE_RENDER_REASON = Object.freeze({
  slotIsNew: "slotIsNew",
  neverRendered: "neverRendered",
  lightMoved: "lightMoved",
  sceneChanged: "sceneChanged",
});

function quantize(value, scale) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.round(numberValue * scale);
}


export function lightPageSignature(light) {
  const source = light || {};
  const position = Array.isArray(source.position) ? source.position : [0, 0, 0];
  const direction = Array.isArray(source.direction) ? source.direction : [0, -1, 0];
  return [
    quantize(position[0], 100),
    quantize(position[1], 100),
    quantize(position[2], 100),
    quantize(direction[0], 1000),
    quantize(direction[1], 1000),
    quantize(direction[2], 1000),
    quantize(source.coneAngle, 1000),
    quantize(source.attenuationRadius, 100),
    quantize(source.near, 1000),
  ].join(",");
}


export function createPageResidency(options) {
  const settings = options || {};
  const budget = Math.max(1, Math.floor(Number(settings.maximumPagesPerFrame) || DEFAULT_MAXIMUM_PAGES_PER_FRAME));
  const stateById = new Map();

  function reasonFor(page, signature, sceneRevision) {
    const state = stateById.get(page.id);
    if (page.isNew) return PAGE_RENDER_REASON.slotIsNew;
    if (!state || !state.rendered) return PAGE_RENDER_REASON.neverRendered;
    if (state.x !== page.x || state.y !== page.y || state.res !== page.res) return PAGE_RENDER_REASON.slotIsNew;
    if (state.signature !== signature) return PAGE_RENDER_REASON.lightMoved;
    if (state.sceneRevision !== sceneRevision) return PAGE_RENDER_REASON.sceneChanged;
    return null;
  }


  function plan(input) {
    const settingsOfPlan = input || {};
    const placedPages = Array.isArray(settingsOfPlan.placedPages) ? settingsOfPlan.placedPages : [];
    const signatureById = settingsOfPlan.signatureById || {};
    const rankById = settingsOfPlan.rankById || {};
    const sceneRevision = settingsOfPlan.sceneRevision === undefined ? 0 : settingsOfPlan.sceneRevision;

    const livePageIds = new Set(placedPages.map((page) => page.id));
    stateById.forEach((state, id) => {


      if (!livePageIds.has(id)) stateById.delete(id);
    });

    const dirtyPages = [];
    const reusedPages = [];
    placedPages.forEach((page) => {
      const signature = signatureById[page.id] || "";
      const reason = reasonFor(page, signature, sceneRevision);
      if (reason) dirtyPages.push({ page, signature, reason, rank: Number(rankById[page.id]) || 0 });
      else reusedPages.push({ id: page.id, x: page.x, y: page.y, res: page.res });
    });


    dirtyPages.sort((first, second) => first.rank - second.rank || first.page.id.localeCompare(second.page.id));

    const render = [];
    const deferred = [];
    dirtyPages.forEach((entry, index) => {
      if (index < budget) {
        render.push({
          id: entry.page.id,
          x: entry.page.x,
          y: entry.page.y,
          res: entry.page.res,
          reason: entry.reason,
          rank: entry.rank,
        });
        return;
      }
      deferred.push({ id: entry.page.id, reason: entry.reason, rank: entry.rank });
    });

    return {
      render,
      reused: reusedPages,
      deferred,
      statistics: {
        budget,
        allocatedPageCount: placedPages.length,
        renderPageCount: render.length,
        reusedPageCount: reusedPages.length,
        deferredPageCount: deferred.length,
      },
    };
  }


  function markRendered(page, signature, sceneRevision) {
    if (!page || !page.id) return null;
    const state = {
      x: page.x,
      y: page.y,
      res: page.res,
      signature: signature || "",
      sceneRevision: sceneRevision === undefined ? 0 : sceneRevision,
      rendered: true,
    };
    stateById.set(page.id, state);
    return state;
  }

  function stateOf(pageId) {
    return stateById.get(pageId) || null;
  }

  function forget(pageId) {
    return stateById.delete(pageId);
  }

  function clear() {
    stateById.clear();
  }

  return { plan, markRendered, stateOf, forget, clear, budget };
}
