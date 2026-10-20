export const HEAL_GRACE_MS = 5000;
export const HEAL_LOST_HOLD_MS = 10000;

export function createShaderHealGate(opts) {
  const graceMs =
    Number(opts && opts.graceMs) > 0 ? Number(opts.graceMs) : HEAL_GRACE_MS;
  const lostHoldMs =
    Number(opts && opts.lostHoldMs) > 0 ? Number(opts.lostHoldMs) : HEAL_LOST_HOLD_MS;
  let lastLostAt = -Infinity;                                     
  let pendingAt = 0;                                                   
  let deferredHeals = 0;
  let skips = 0;

  return {
    graceMs,
    lostHoldMs,


    onShaderError(infoEmpty, now) {
      if (!infoEmpty) return "heal";                                    
      if (now - lastLostAt <= lostHoldMs) {
        skips++;
        return "skip";                           
      }
      if (pendingAt) {
        skips++;
        return "skip";                                  
      }
      pendingAt = now;
      return "defer";
    },

    onContextLost(now) {
      lastLostAt = now;
      pendingAt = 0;
    },


    onDeferTimer(now, contextLost) {
      if (!pendingAt) {
        skips++;
        return "skip";                                           
      }
      pendingAt = 0;
      if (contextLost || now - lastLostAt <= lostHoldMs) {
        skips++;
        return "skip";
      }
      deferredHeals++;
      return "heal";
    },

    debug() {
      return {
        pending: pendingAt !== 0,
        lastLostAt,
        deferredHeals,
        skips,
        graceMs,
        lostHoldMs,
      };
    },
  };
}
