import { bus } from "../core/eventBus.js";
import { logger as baseLogger } from "../core/logger.js";
import { humTakeDamage } from "./humanoid.js";

const TOUCH_DAMAGE_TICK_MS = 1000;                                                      

let active = false;
let getChar = () => null;
let getHum = () => null;
let getPlayer = () => null;
let log = baseLogger;
let offs = [];


const contacts = new Map();


function belongsToCharacter(part, character) {
  if (!part || !character) return false;
  let cur = part;
  for (let i = 0; i < 32 && cur; i++) {
    if (cur === character) return true;
    cur = cur.getParent ? cur.getParent() : null;
  }
  return false;
}


function worldSideOf(a, b, character) {
  if (belongsToCharacter(a, character)) return b;
  if (belongsToCharacter(b, character)) return a;
  return null;
}


function isSpawnEnabled(spawn) {
  try {
    if (spawn.hasProperty && !spawn.hasProperty("Enabled")) return true;
    return !spawn.getProperty || spawn.getProperty("Enabled") !== false;
  } catch (_) {
    return true;
  }
}


function touchDamageOf(part) {
  if (!part || !part.getAttribute) return null;
  let dmg = null;
  try { dmg = part.getAttribute("TouchDamage"); } catch (_) { return null; }
  const n = Number(dmg);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function applyTouchDamage(part) {
  const hum = getHum();
  if (!hum) return;
  const n = touchDamageOf(part);
  if (n == null) return;
  humTakeDamage(hum, n);                                               
}

function applyCheckpoint(part) {
  if (!part || part.className !== "SpawnLocation" || !part.getAttribute) return;
  let flag = null;
  try { flag = part.getAttribute("Checkpoint"); } catch (_) { return; }
  if (flag !== true) return;
  if (!isSpawnEnabled(part)) return;
  const player = getPlayer();
  if (!player) return;
  let current = null;
  try { current = player.getProperty ? player.getProperty("RespawnLocation") : null; } catch (_) { current = null; }
  if (current === part) return;                                        
  try { player.setProperty("RespawnLocation", part); } catch (_) { return; }
  log.info(`Checkpoint ativado: ${part.name}`, { source: "Playtest" });
}

function onTouched(payload) {
  if (!active || !payload) return;
  const character = getChar();
  if (!character) return;
  const part = worldSideOf(payload.a, payload.b, character);
  if (!part) return;
  applyTouchDamage(part);


  if (touchDamageOf(part) != null) contacts.set(part, { at: 0, character });
  applyCheckpoint(part);
}

function onTouchEnded(payload) {
  if (!active || !payload || contacts.size === 0) return;
  const character = getChar();
  if (!character) return;
  const part = worldSideOf(payload.a, payload.b, character);
  if (part) contacts.delete(part);
}

export const touchBehaviors = {

  start(opts = {}) {
    if (active) this.stop();
    active = true;
    getChar = opts.getCharacter || (() => null);
    getHum = opts.getHumanoid || (() => null);
    getPlayer = opts.getLocalPlayer || (() => null);
    log = opts.logger || baseLogger;
    offs = [
      bus.on("physics:touched", onTouched),
      bus.on("physics:touchEnded", onTouchEnded),
    ];
  },

  stop() {
    active = false;
    for (const off of offs) { try { off(); } catch (_) {            } }
    offs = [];
    contacts.clear();
    getChar = () => null;
    getHum = () => null;
    getPlayer = () => null;
    log = baseLogger;
  },


  update(tms) {
    if (!active || contacts.size === 0 || typeof tms !== "number") return;
    const character = getChar();
    const hum = getHum();
    let health = 0;
    try { health = hum && hum.getProperty ? Number(hum.getProperty("Health")) : 0; } catch (_) { health = 0; }
    for (const [part, c] of contacts) {


      if (!character || c.character !== character) { contacts.delete(part); continue; }


      if (part.getParent && !part.getParent()) { contacts.delete(part); continue; }
      if (!(health > 0)) continue;                                  
      if (c.at === 0) { c.at = tms + TOUCH_DAMAGE_TICK_MS; continue; }
      if (tms >= c.at) {
        applyTouchDamage(part);                                
        c.at = tms + TOUCH_DAMAGE_TICK_MS;                                    
      }
    }
  },


  _onTouched(payload) { onTouched(payload); },
  _onTouchEnded(payload) { onTouchEnded(payload); },
};
