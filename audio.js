/* ===========================================================
 * audio.js — 외부 파일 없이 WebAudio로 합성하는 효과음
 * =========================================================== */
(function (G) {
  'use strict';
  let ctx = null, master = null, noiseBuf = null, vol = 0.6;

  function ensure() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function noise(dur, type, f0, f1, gain, q) {
    if (!ensure()) return;
    const t = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.loop = true; f.type = type; f.Q.value = q || 0.8;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t); src.stop(t + dur + 0.05);
  }
  function tone(f0, f1, dur, type, gain, delay) {
    if (!ensure()) return;
    const t = ctx.currentTime + (delay || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }

  G.Sfx = {
    unlock: ensure,
    setVolume(v) { vol = v; if (master) master.gain.value = v; },
    play(name, k) {
      if (vol <= 0.001) return;
      switch (name) {
        case 'break': noise(0.16, 'lowpass', 1400, 300, 0.7, 0.5); tone(150, 70, 0.1, 'triangle', 0.25); break;
        case 'place': tone(240, 120, 0.09, 'triangle', 0.4); noise(0.06, 'lowpass', 800, 300, 0.25); break;
        case 'hurt': tone(260, 80, 0.28, 'sawtooth', 0.35); noise(0.2, 'lowpass', 900, 200, 0.4); break;
        case 'land': noise(0.14, 'lowpass', 500, 120, Math.min(0.9, 0.25 + (k || 0) * 0.04)); break;
        case 'glide': noise(0.5, 'bandpass', 500, 2200, 0.3, 0.6); tone(520, 880, 0.25, 'sine', 0.08); break;
        case 'splash': noise(0.3, 'bandpass', 1800, 500, 0.5, 0.7); break;
        case 'respawn': [523, 659, 784, 1047].forEach((f, i) => tone(f, f * 1.002, 0.3, 'sine', 0.18, i * 0.08)); break;
        case 'click': tone(700, 500, 0.04, 'square', 0.06); break;
      }
    }
  };
})(window.LUMINA = window.LUMINA || {});
