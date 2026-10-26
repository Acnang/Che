/* ===========================================================
 * noise.js — 시드 기반 퍼린 노이즈 / 해시 / 난수
 * =========================================================== */
(function (G) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 정수 좌표 해시 → [0,1) */
  function hash2(x, z, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function hash3(x, y, z, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 1103515245) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /** 문자열/숫자 시드 → 정수 */
  function seedFrom(v) {
    if (typeof v === 'number') return v | 0;
    const s = String(v == null ? '' : v).trim();
    if (s === '') return (Math.random() * 2147483647) | 0;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10) | 0;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h | 0;
  }

  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;

  class Noise {
    constructor(seed) {
      const rnd = mulberry32(seed | 0), p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) p[i] = i;
      for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0, t = p[i]; p[i] = p[j]; p[j] = t; }
      this.p = new Uint8Array(512);
      for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
    }
    n2(x, y) {
      const p = this.p;
      const X = Math.floor(x), Y = Math.floor(y);
      x -= X; y -= Y;
      const xi = X & 255, yi = Y & 255;
      const u = fade(x), v = fade(y);
      const aa = p[p[xi] + yi], ab = p[p[xi] + yi + 1], ba = p[p[xi + 1] + yi], bb = p[p[xi + 1] + yi + 1];
      return lerp(
        lerp(g2(aa, x, y), g2(ba, x - 1, y), u),
        lerp(g2(ab, x, y - 1), g2(bb, x - 1, y - 1), u), v) * 1.35;
    }
    n3(x, y, z) {
      const p = this.p;
      const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
      x -= X; y -= Y; z -= Z;
      const xi = X & 255, yi = Y & 255, zi = Z & 255;
      const u = fade(x), v = fade(y), w = fade(z);
      const A = p[xi] + yi, AA = p[A] + zi, AB = p[A + 1] + zi;
      const B = p[xi + 1] + yi, BA = p[B] + zi, BB = p[B + 1] + zi;
      return lerp(
        lerp(lerp(g3(p[AA], x, y, z), g3(p[BA], x - 1, y, z), u), lerp(g3(p[AB], x, y - 1, z), g3(p[BB], x - 1, y - 1, z), u), v),
        lerp(lerp(g3(p[AA + 1], x, y, z - 1), g3(p[BA + 1], x - 1, y, z - 1), u), lerp(g3(p[AB + 1], x, y - 1, z - 1), g3(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
    }
    /** 프랙탈 합성 (대략 -1..1) */
    fbm2(x, y, oct) {
      let a = 1, f = 1, s = 0, n = 0;
      for (let i = 0; i < oct; i++) { s += this.n2(x * f, y * f) * a; n += a; a *= 0.5; f *= 2.02; }
      return s / n;
    }
  }
  function g2(h, x, y) {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  }
  function g3(h, x, y, z) {
    h &= 15;
    const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }

  G.Noise = Noise; G.hash2 = hash2; G.hash3 = hash3; G.mulberry32 = mulberry32; G.seedFrom = seedFrom;
})(window.LUMINA = window.LUMINA || {});
