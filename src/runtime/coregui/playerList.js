import { listTeams, teamPlayers, brickRgb } from "../social.js";
import { computeMiniMenuPosition } from "./miniMenuPlacement.js";

function playerDisplayName(pl) {
  let dn = "";
  try { dn = pl.getProperty("DisplayName"); } catch (_) { dn = ""; }
  return (dn && String(dn)) || pl.name || "Player";
}


function formatStatValue(v) {
  if (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)) {
    return String(Math.round(v * 100) / 100);
  }
  return String(v);
}

function leaderstatEntries(pl) {
  const out = [];
  if (!pl || typeof pl.findFirstChild !== "function") return out;
  const folder = pl.findFirstChild("leaderstats");
  if (!folder || (folder.className !== "Folder" && folder.className !== "Model")) return out;
  for (const c of folder.getChildren()) {
    let v = null;
    try { v = c.getProperty("Value"); } catch (_) { v = null; }
    if (v !== null && v !== undefined) out.push({ name: c.name, value: formatStatValue(v) });
    if (out.length >= 4) break;
  }
  return out;
}

export function createPlayerList({ root, t, getDataModel, getLocalPlayer, notify }) {
  const host = document.createElement("div");
  host.className = "rsw-cg__plist";
  root.appendChild(host);


  host.addEventListener("scroll", positionMiniMenuNearRow);

  const rowCache = new Map();                                             
  const headCache = new Map();                                            
  let miniMenu = null;
  let miniMenuAnchorRow = null;
  let lastOrderSig = "";

  function closeMiniMenu() {
    if (miniMenu && miniMenu.parentNode) miniMenu.parentNode.removeChild(miniMenu);
    miniMenu = null;
    miniMenuAnchorRow = null;
  }


  function positionMiniMenuNearRow() {
    if (!miniMenu || !miniMenuAnchorRow) return;
    const anchorRect = miniMenuAnchorRow.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const isAnchorRowVisible =
      anchorRect.bottom > hostRect.top && anchorRect.top < hostRect.bottom;
    if (!isAnchorRowVisible) {
      closeMiniMenu();
      return;
    }
    const { left, top } = computeMiniMenuPosition({
      anchorRect,
      rootRect: root.getBoundingClientRect(),
      menuSize: { width: miniMenu.offsetWidth, height: miniMenu.offsetHeight },
    });
    miniMenu.style.left = left + "px";
    miniMenu.style.top = top + "px";
  }

  function openMiniMenu(anchorEl, pl) {
    closeMiniMenu();
    miniMenu = document.createElement("div");
    miniMenu.className = "rsw-cg__plist-menu";
    const actions = [
      [t("viewProfile"), () => notify(t("placeholderAction"))],
      [t("addFriend"), () => notify(t("placeholderAction"))],
      [t("report"), () => notify(t("reportThanks"))],
    ];
    for (const [label, fn] of actions) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", (e) => { e.stopPropagation(); closeMiniMenu(); fn(); });
      miniMenu.appendChild(b);
    }


    root.appendChild(miniMenu);
    miniMenuAnchorRow = anchorEl;
    positionMiniMenuNearRow();
    void pl;
  }

  function rowFor(pl) {
    let r = rowCache.get(pl.id);
    if (r) return r;
    const el = document.createElement("div");
    el.className = "rsw-cg__plist-row";
    const avatar = document.createElement("span");
    avatar.className = "rsw-cg__avatar";
    const nameEl = document.createElement("span");
    nameEl.className = "rsw-cg__plist-name";
    const statsEl = document.createElement("span");
    statsEl.className = "rsw-cg__plist-stats";
    el.append(avatar, nameEl, statsEl);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openMiniMenu(el, pl);
    });
    r = { el, avatar, nameEl, statsEl, sig: "" };
    rowCache.set(pl.id, r);
    return r;
  }

  function headFor(key) {
    let h = headCache.get(key);
    if (h) return h;
    const el = document.createElement("div");
    el.className = "rsw-cg__plist-team";
    const nameEl = document.createElement("span");
    const scoreEl = document.createElement("span");
    el.append(nameEl, scoreEl);
    h = { el, nameEl, scoreEl, sig: "" };
    headCache.set(key, h);
    return h;
  }

  function listAllPlayers(dm) {
    if (!dm || typeof dm.findFirstChild !== "function") return [];
    const svc = dm.findFirstChild("Players");
    if (!svc) return [];
    return svc.getChildren().filter((c) => c.className === "Player");
  }

  function update() {
    const dm = getDataModel();
    const local = getLocalPlayer();
    const players = listAllPlayers(dm);
    const teams = dm ? listTeams(dm) : [];
    const byName = (a, b) => playerDisplayName(a).localeCompare(playerDisplayName(b));


    const groups = [];
    const claimed = new Set();
    for (const team of teams) {
      const members = teamPlayers(team).filter((p) => players.includes(p)).sort(byName);
      for (const m of members) claimed.add(m);
      groups.push({ team, members });
    }
    const neutral = players.filter((p) => !claimed.has(p)).sort(byName);
    if (neutral.length) groups.push({ team: null, members: neutral });

    const orderSig = groups.map((g) =>
      (g.team ? g.team.id || g.team.name : "~") + ":" + g.members.map((p) => p.id).join(",")
    ).join("|");

    if (orderSig !== lastOrderSig) {
      lastOrderSig = orderSig;
      closeMiniMenu();
      const frag = document.createDocumentFragment();
      const liveIds = new Set();
      const liveKeys = new Set();
      for (const g of groups) {
        if (g.team) { const k = g.team.id || g.team.name; liveKeys.add(k); frag.appendChild(headFor(k).el); }
        for (const pl of g.members) { liveIds.add(pl.id); frag.appendChild(rowFor(pl).el); }
      }


      for (const id of Array.from(rowCache.keys())) if (!liveIds.has(id)) rowCache.delete(id);
      for (const k of Array.from(headCache.keys())) if (!liveKeys.has(k)) headCache.delete(k);
      host.replaceChildren(frag);
    }


    for (const g of groups) {
      if (g.team) {
        const h = headFor(g.team.id || g.team.name);
        const rgb = brickRgb(g.team.getProperty("TeamColor"));
        const score = Number(g.team.getProperty("Score")) || 0;
        const sig = g.team.name + "|" + rgb.join(",") + "|" + score;
        if (sig !== h.sig) {
          h.sig = sig;
          h.nameEl.textContent = g.team.name;
          h.scoreEl.textContent = String(score);
          h.el.style.background = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.55)`;
        }
      }
      for (const pl of g.members) {
        const r = rowFor(pl);
        const dn = playerDisplayName(pl);
        const stats = leaderstatEntries(pl);
        const isLocal = pl === local;
        const sig = dn + "|" + stats.map((s) => s.name + "=" + s.value).join(";") + "|" + (isLocal ? "L" : "");
        if (sig === r.sig) continue;
        r.sig = sig;
        r.avatar.textContent = dn.slice(0, 1).toUpperCase();
        r.nameEl.textContent = dn;
        r.el.classList.toggle("is-local", isLocal);
        r.statsEl.replaceChildren();
        for (const s of stats) {
          const cell = document.createElement("span");
          cell.textContent = s.value;
          cell.title = s.name;
          r.statsEl.appendChild(cell);
        }
      }
    }
  }

  return {
    el: host,
    update,
    setVisible(v) {
      host.hidden = !v;
      if (!v) closeMiniMenu();
    },
    isVisible: () => !host.hidden,
    destroy() {
      closeMiniMenu();
      host.removeEventListener("scroll", positionMiniMenuNearRow);
      rowCache.clear();
      headCache.clear();
      if (host.parentNode) host.parentNode.removeChild(host);
    },
  };
}
