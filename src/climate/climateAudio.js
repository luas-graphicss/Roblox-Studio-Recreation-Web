const PRESETS = Object.freeze({
  rain: { filter: "bandpass", freq: 2400, q: 0.5, gain: 0.4 },
  heavyrain: { filter: "bandpass", freq: 1500, q: 0.4, gain: 0.65 },
  wind: { filter: "lowpass", freq: 480, q: 0.7, gain: 0.22 },
  coldwind: { filter: "lowpass", freq: 700, q: 0.9, gain: 0.3 },
  blizzard: { filter: "lowpass", freq: 950, q: 1, gain: 0.55 },
  sandstorm: { filter: "bandpass", freq: 420, q: 0.4, gain: 0.5 },
});

const FADE_S = 0.8;

let ctx = null;
let noiseBuf = null;
const channels = new Map();
let failed = false;

function getCtx() {
  if (failed) return null;
  if (ctx) return ctx;
  try {
    const AC = typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AC) {
      failed = true;
      return null;
    }
    ctx = new AC();
    return ctx;
  } catch (_) {
    failed = true;
    return null;
  }
}

function getNoiseBuffer(ac) {
  if (noiseBuf) return noiseBuf;
  const len = ac.sampleRate * 2;
  noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = last * 0.6 + white * 0.4;
    data[i] = last;
  }
  return noiseBuf;
}

function ensureChannel(kind) {
  const ac = getCtx();
  const preset = PRESETS[kind];
  if (!ac || !preset) return null;
  let ch = channels.get(kind);
  if (ch) return ch;
  try {
    const src = ac.createBufferSource();
    src.buffer = getNoiseBuffer(ac);
    src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = preset.filter;
    filter.frequency.value = preset.freq;
    filter.Q.value = preset.q;
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);
    src.start();
    ch = { kind, src, filter, gain, silenceTimer: null, lastTarget: 0 };
    channels.set(kind, ch);
    return ch;
  } catch (_) {
    return null;
  }
}

function stopChannel(ch) {
  try { ch.src.stop(); } catch (_) {          }
  try { ch.gain.disconnect(); } catch (_) {          }
}

function rampGain(ch, target) {
  const ac = getCtx();
  if (!ac || !ch) return;
  const t = Math.max(0, target);


  if (ch.lastTarget == null || Math.abs(ch.lastTarget - t) > 0.0005) {
    try {
      const now = ac.currentTime;
      ch.gain.gain.cancelScheduledValues(now);
      ch.gain.gain.setValueAtTime(ch.gain.gain.value, now);
      ch.gain.gain.linearRampToValueAtTime(t, now + FADE_S);
      ch.lastTarget = t;
    } catch (_) {          }
  }


  if (t > 0) {
    if (ch.silenceTimer) {
      clearTimeout(ch.silenceTimer);
      ch.silenceTimer = null;
    }
  } else if (!ch.silenceTimer) {
    ch.silenceTimer = setTimeout(() => {
      ch.silenceTimer = null;
      if (channels.get(ch.kind) !== ch) return;
      channels.delete(ch.kind);


      try {
        ch.gain.gain.cancelScheduledValues(ctx ? ctx.currentTime : 0);
        ch.gain.gain.value = 0;
      } catch (_) {          }
      stopChannel(ch);
    }, (FADE_S + 0.25) * 1000);
  }
}

export function setClimateAmbient(target) {
  const wantKind = target && target.kind && PRESETS[target.kind] ? target.kind : null;
  const level = wantKind ? Math.min(1, Math.max(0, Number(target.level) || 0)) : 0;
  const audible = wantKind != null && level > 0;


  if (!audible && (!ctx || channels.size === 0)) return false;
  const ac = getCtx();
  if (!ac) return false;
  if (audible && ac.state === "suspended" && typeof ac.resume === "function") {
    try {
      const p = ac.resume();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {          }
  }
  if (wantKind && level > 0) {
    const ch = ensureChannel(wantKind);
    if (ch) rampGain(ch, PRESETS[wantKind].gain * level);
  }
  for (const [kind, ch] of channels) {
    if (kind !== wantKind || level <= 0) rampGain(ch, 0);
  }
  return true;
}

export function stopClimateAmbient() {
  for (const [, ch] of channels) rampGain(ch, 0);
}

export function disposeClimateAudio() {
  for (const [, ch] of channels) {
    if (ch.silenceTimer) {
      clearTimeout(ch.silenceTimer);
      ch.silenceTimer = null;
    }


    let scheduled = false;
    if (ctx) {
      try {
        const now = ctx.currentTime;
        ch.gain.gain.cancelScheduledValues(now);
        ch.gain.gain.setValueAtTime(ch.gain.gain.value, now);
        ch.gain.gain.linearRampToValueAtTime(0, now + 0.03);
        ch.src.stop(now + 0.05);
        scheduled = true;
      } catch (_) {          }
    }
    if (!scheduled) {
      try { ch.gain.gain.value = 0; } catch (_) {          }
      stopChannel(ch);
    }
  }
  channels.clear();
}
