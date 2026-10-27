/* ===========================================================
 * blocks.js — 블록 정의 + 절차적(프로시저럴) 텍스처 아틀라스
 *  32px 타일, 절제된 팔레트 + 타일링 가능한 노이즈 + 은은한 베벨
 * =========================================================== */
(function (G) {
  'use strict';

  const B = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, PLANKS: 7, BRICK: 8, GLASS: 9,
    WATER: 10, SNOW: 11, CRYSTAL: 12, BEDROCK: 13, SLATE: 14, QUARTZ: 15, TALLGRASS: 16, FLOWER: 17, GLOWBLOOM: 18
  };
  const T = {
    GRASS_TOP: 0, GRASS_SIDE: 1, DIRT: 2, STONE: 3, SAND: 4, LOG_SIDE: 5, LOG_TOP: 6, LEAVES: 7, PLANKS: 8, BRICK: 9,
    GLASS: 10, WATER: 11, SNOW_TOP: 12, SNOW_SIDE: 13, CRYSTAL: 14, BEDROCK: 15, SLATE: 16, QUARTZ: 17,
    TALLGRASS: 18, FLOWER: 19, GLOWBLOOM: 20
  };
  const COLS = 8, ROWS = 4, TS = 32;

  // 블록 정의: tiles = [위, 아래, 옆]
  const INFO = [];
  function def(id, name, tiles, o) {
    INFO[id] = Object.assign({ id, name, tiles, solid: true, occ: true, trans: false, plant: false, emit: false, place: true, target: true }, o || {});
  }
  def(B.AIR, '공기', [0, 0, 0], { solid: false, occ: false, place: false, target: false });
  def(B.GRASS, '잔디', [T.GRASS_TOP, T.DIRT, T.GRASS_SIDE]);
  def(B.DIRT, '흙', [T.DIRT, T.DIRT, T.DIRT]);
  def(B.STONE, '돌', [T.STONE, T.STONE, T.STONE]);
  def(B.SAND, '모래', [T.SAND, T.SAND, T.SAND]);
  def(B.LOG, '통나무', [T.LOG_TOP, T.LOG_TOP, T.LOG_SIDE]);
  def(B.LEAVES, '나뭇잎', [T.LEAVES, T.LEAVES, T.LEAVES]);
  def(B.PLANKS, '판자', [T.PLANKS, T.PLANKS, T.PLANKS]);
  def(B.BRICK, '벽돌', [T.BRICK, T.BRICK, T.BRICK]);
  def(B.GLASS, '유리', [T.GLASS, T.GLASS, T.GLASS], { occ: false, trans: true });
  def(B.WATER, '물', [T.WATER, T.WATER, T.WATER], { solid: false, occ: false, trans: true, place: false, target: false, liquid: true });
  def(B.SNOW, '눈', [T.SNOW_TOP, T.DIRT, T.SNOW_SIDE]);
  def(B.CRYSTAL, '루미나 크리스탈', [T.CRYSTAL, T.CRYSTAL, T.CRYSTAL], { emit: true });
  def(B.BEDROCK, '기반암', [T.BEDROCK, T.BEDROCK, T.BEDROCK], { place: false, unbreakable: true });
  def(B.SLATE, '심층암', [T.SLATE, T.SLATE, T.SLATE]);
  def(B.QUARTZ, '석영', [T.QUARTZ, T.QUARTZ, T.QUARTZ]);
  def(B.TALLGRASS, '풀', [T.TALLGRASS, T.TALLGRASS, T.TALLGRASS], { solid: false, occ: false, plant: true });
  def(B.FLOWER, '붉은 꽃', [T.FLOWER, T.FLOWER, T.FLOWER], { solid: false, occ: false, plant: true });
  def(B.GLOWBLOOM, '발광초', [T.GLOWBLOOM, T.GLOWBLOOM, T.GLOWBLOOM], { solid: false, occ: false, plant: true, emit: true });

  const SOLID = new Uint8Array(256), OCC = new Uint8Array(256), TRANS = new Uint8Array(256), PLANT = new Uint8Array(256), EMIT = new Uint8Array(256), TARGET = new Uint8Array(256);
  INFO.forEach(b => { SOLID[b.id] = +b.solid; OCC[b.id] = +b.occ; TRANS[b.id] = +b.trans; PLANT[b.id] = +b.plant; EMIT[b.id] = +b.emit; TARGET[b.id] = +b.target; });

  const PLACEABLE = INFO.filter(b => b.place).map(b => b.id);
  const DEFAULT_HOTBAR = [B.STONE, B.PLANKS, B.GLASS, 100, 101, 102, 103, 104, B.CRYSTAL];   // 100~104 = 검/활/폭탄/철갑옷/크리스탈갑옷

  /* ---------- 노이즈/색 유틸 ---------- */
  const hs = G.hash2;
  const H = (x, y, s) => hs(x, y, s * 7919 + 13);
  function vnwa(x, y, cx, cy, seed) {
    const nx = TS / cx, ny = TS / cy, fx = x / cx, fy = y / cy;
    const xi = Math.floor(fx), yi = Math.floor(fy), xf = fx - xi, yf = fy - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const wx = a => ((a % nx) + nx) % nx, wy = a => ((a % ny) + ny) % ny;
    const a = H(wx(xi), wy(yi), seed), b = H(wx(xi + 1), wy(yi), seed), c = H(wx(xi), wy(yi + 1), seed), d = H(wx(xi + 1), wy(yi + 1), seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  const vnw = (x, y, c, s) => vnwa(x, y, c, c, s);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 255];
  const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k, c[3] === undefined ? 255 : c[3]];

  /* ---------- 타일 페인터 ---------- */
  const P = {};
  P[T.GRASS_TOP] = (x, y) => {
    const n = vnw(x, y, 8, 1) * 0.5 + vnw(x, y, 4, 2) * 0.3 + vnw(x, y, 2, 3) * 0.2;
    let c = mix([82, 140, 60], [126, 183, 84], n);
    const r = H(x, y, 4);
    if (r < 0.07) c = mul(c, 0.82); else if (r > 0.94) c = mul(c, 1.12);
    return c;
  };
  P[T.DIRT] = (x, y) => {
    const n = vnw(x, y, 8, 11) * 0.5 + vnw(x, y, 4, 12) * 0.5;
    let c = mix([116, 81, 56], [146, 105, 75], n);
    const p = vnw(x, y, 2, 13);
    if (p > 0.82) c = mul(c, 0.78); else if (p < 0.12) c = mul(c, 1.16);
    return c;
  };
  const grassBand = x => 6 + Math.floor(H(x, 0, 5) * 3);
  P[T.GRASS_SIDE] = (x, y) => {
    const b = grassBand(x);
    if (y < b) { const c = P[T.GRASS_TOP](x, y); return y >= b - 2 ? mul(c, 0.9) : c; }
    return P[T.DIRT](x, y);
  };
  P[T.STONE] = (x, y) => {
    const n = vnw(x, y, 8, 21) * 0.6 + vnw(x, y, 4, 22) * 0.4;
    let c = mix([114, 119, 128], [150, 154, 163], n);
    if (Math.abs(vnw(x, y, 8, 23) - 0.5) < 0.022) c = mul(c, 0.74);
    const h = H(x, y, 24);
    if (h > 0.965) c = mul(c, 1.14); else if (h < 0.03) c = mul(c, 0.86);
    return c;
  };
  P[T.SLATE] = (x, y) => {
    const n = vnw(x, y, 8, 25) * 0.6 + vnw(x, y, 4, 26) * 0.4;
    let c = mix([54, 56, 70], [86, 88, 104], n);
    if (Math.abs(vnw(x, y, 8, 27) - 0.5) < 0.02) c = mul(c, 0.7);
    if (H(x, y, 28) > 0.97) c = [118, 122, 142, 255];
    return c;
  };
  P[T.SAND] = (x, y) => {
    const n = vnw(x, y, 8, 31) * 0.5 + vnw(x, y, 4, 32) * 0.5;
    let c = mix([214, 198, 144], [238, 224, 174], n);
    const h = H(x, y, 33);
    if (h < 0.06) c = mul(c, 0.9); else if (h > 0.97) c = mul(c, 1.06);
    return c;
  };
  P[T.LOG_SIDE] = (x, y) => {
    const n = vnwa(x, y, 2, 16, 34);
    let c = mix([88, 62, 40], [128, 95, 61], n);
    if (vnwa(x, y, 4, 32, 35) > 0.72) c = mul(c, 0.8);
    if (H(x, y, 36) > 0.97) c = mul(c, 0.85);
    return c;
  };
  P[T.LOG_TOP] = (x, y) => {
    const dx = x - 15.5, dy = y - 15.5, d = Math.sqrt(dx * dx + dy * dy);
    if (d > 13.6 || Math.max(Math.abs(dx), Math.abs(dy)) > 14.2) return mul(P[T.LOG_SIDE](x, y), 0.95);
    const ring = 0.5 + 0.5 * Math.sin(d * 1.45 + vnw(x, y, 8, 37) * 2.4);
    return mix([152, 114, 72], [196, 156, 102], ring);
  };
  P[T.LEAVES] = (x, y) => {
    const n = vnw(x, y, 4, 41) * 0.55 + vnw(x, y, 2, 42) * 0.45;
    let c = mix([34, 88, 48], [80, 152, 74], n);
    const h = H(x, y, 43);
    if (h > 0.9) c = [24, 66, 38, 255]; else if (h < 0.035) c = [122, 190, 98, 255];
    return c;
  };
  P[T.PLANKS] = (x, y) => {
    const board = Math.floor(y / 8), by = y % 8;
    const t = H(board, 1, 51);
    let c = mix([172, 130, 82], [206, 163, 108], t);
    c = mul(c, 0.93 + 0.14 * vnwa(x, y, 16, 2, 52));
    if (by === 0) c = mul(c, 0.7); else if (by === 1) c = mul(c, 1.07);
    const seam = [10, 26, 18, 4][board];
    if (x === seam) c = mul(c, 0.72);
    if ((x === seam + 2 || x === seam - 2) && (by === 3 || by === 4) && false) c = mul(c, 0.8);
    return c;
  };
  P[T.BRICK] = (x, y) => {
    const row = Math.floor(y / 8), by = y % 8, off = (row % 2) * 8, bx = (x + off) % 16;
    if (by === 0 || bx === 0) return mul([184, 176, 166], 0.92 + 0.12 * H(x, y, 61));
    const id = H(Math.floor((x + off) / 16), row, 62);
    let c = mix([142, 70, 56], [180, 100, 76], id);
    c = mul(c, 0.9 + 0.18 * vnw(x, y, 2, 63));
    if (by === 1) c = mul(c, 1.1); else if (by === 7) c = mul(c, 0.88);
    return c;
  };
  P[T.QUARTZ] = (x, y) => {
    const n = vnw(x, y, 8, 71);
    let c = mix([232, 230, 226], [248, 246, 242], n);
    if (Math.abs(vnwa(x, y, 16, 8, 72) - 0.5) < 0.024) c = [194, 200, 214, 255];
    if (x === 31 || y === 31) c = mul(c, 0.93);
    return c;
  };
  P[T.GLASS] = (x, y) => {
    const e = Math.min(x, y, 31 - x, 31 - y);
    if (e < 2) return [208, 236, 246, 215];
    let a = 40, c = [184, 224, 240];
    const s = x + y;
    if ((s >= 9 && s <= 12) || s === 17) { c = [255, 255, 255]; a = s === 17 ? 100 : 140; }
    return [c[0], c[1], c[2], a];
  };
  P[T.WATER] = (x, y) => {
    const n = vnw(x, y, 8, 81) * 0.5 + vnw(x, y, 4, 82) * 0.5;
    let c = mix([38, 98, 182], [64, 138, 214], n);
    if (Math.abs(vnwa(x, y, 16, 4, 83) - 0.5) < 0.04) c = [150, 202, 244, 255];
    return [c[0], c[1], c[2], 196];
  };
  P[T.SNOW_TOP] = (x, y) => {
    const n = vnw(x, y, 8, 91) * 0.6 + vnw(x, y, 2, 92) * 0.4;
    let c = mix([220, 233, 248], [248, 251, 255], n);
    if (H(x, y, 93) > 0.96) c = mul(c, 0.95);
    return c;
  };
  P[T.SNOW_SIDE] = (x, y) => {
    const b = 7 + Math.floor(H(x, 0, 94) * 3);
    if (y < b) return mul(P[T.SNOW_TOP](x, y), y >= b - 2 ? 0.94 : 1);
    return P[T.DIRT](x, y);
  };
  P[T.BEDROCK] = (x, y) => {
    const n = vnw(x, y, 4, 95);
    let c = mix([30, 30, 36], [72, 72, 84], n);
    if (H(x, y, 96) > 0.9) c = mul(c, 0.6);
    return c;
  };
  // 크리스탈: 보로노이 면 + 시안→바이올렛 그라데이션
  const CPTS = [[6, 8], [22, 5], [14, 17], [27, 22], [5, 26], [17, 29], [28, 10]];
  const CCOL = [[96, 214, 255], [128, 192, 255], [168, 152, 255], [112, 232, 242], [192, 134, 255], [92, 174, 255], [150, 220, 255]];
  P[T.CRYSTAL] = (x, y) => {
    let d1 = 1e9, d2 = 1e9, k = 0;
    for (let i = 0; i < CPTS.length; i++) {
      for (let ox = -32; ox <= 32; ox += 32) for (let oy = -32; oy <= 32; oy += 32) {
        const dx = x - (CPTS[i][0] + ox), dy = y - (CPTS[i][1] + oy), d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; k = i; } else if (d < d2) d2 = d;
      }
    }
    let c = mul(CCOL[k], 1.12 - 0.05 * d1 + 0.12 * H(k, 3, 97));
    if (d2 - d1 < 1.35) c = [236, 250, 255, 255];
    else if (d2 - d1 < 2.4) c = mul(c, 1.12);
    return [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2]), 255];
  };

  // 식물(픽셀 맵 기반)
  function plantMap(build) {
    const m = new Map();
    const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && x < TS && y >= 0 && y < TS) m.set(y * TS + x, c); };
    build(put);
    return (x, y) => m.get(y * TS + x) || [0, 0, 0, 0];
  }
  P[T.TALLGRASS] = plantMap(put => {
    const blades = [[5, 17, -3], [9, 24, 2], [13, 29, -2], [17, 23, 3], [21, 27, -1], [25, 17, 2], [28, 21, -3], [11, 12, 1]];
    for (const [x0, h, lean] of blades) {
      for (let i = 0; i <= h; i++) {
        const t = i / h, x = x0 + lean * Math.pow(t, 1.6), y = 31 - i;
        const c = mix([46, 104, 44], [158, 210, 100], Math.pow(t, 0.8));
        put(x, y, c); if (t < 0.65) put(x + 1, y, mul(c, 0.86));
      }
    }
  });
  P[T.FLOWER] = plantMap(put => {
    for (let y = 31; y > 15; y--) { put(15, y, [58, 126, 58, 255]); put(16, y, [78, 150, 70, 255]); }
    for (let i = 0; i < 4; i++) { put(13 - i, 25 - i, [74, 148, 66, 255]); put(18 + i, 22 - i, [74, 148, 66, 255]); put(12 - i, 25 - i, [58, 120, 52, 255]); put(19 + i, 22 - i, [58, 120, 52, 255]); }
    for (let y = 3; y < 20; y++) for (let x = 7; x < 25; x++) {
      const dx = x - 15.5, dy = y - 11, d = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
      const r = 4.6 + 2.0 * Math.cos(5 * a);
      if (d < 2.3) put(x, y, [255, 214, 92, 255]);
      else if (d <= r) put(x, y, mix([200, 48, 80], [244, 98, 122], Math.min(1, d / 7)));
    }
  });
  P[T.GLOWBLOOM] = plantMap(put => {
    for (let y = 31; y > 14; y--) { put(15, y, [48, 140, 124, 255]); put(16, y, [70, 170, 150, 255]); }
    for (let i = 0; i < 4; i++) { put(13 - i, 26 - i, [70, 170, 150, 255]); put(18 + i, 23 - i, [70, 170, 150, 255]); }
    for (let y = 0; y < 22; y++) for (let x = 5; x < 27; x++) {
      const dx = x - 15.5, dy = y - 10, d = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
      const r = 4.2 + 2.6 * Math.abs(Math.cos(3 * a));
      if (d < 2.2) put(x, y, [255, 255, 255, 255]);
      else if (d <= r) put(x, y, mix([86, 214, 255], [180, 246, 255], Math.max(0, 1 - d / 7)));
      else if (d <= r + 2.4) put(x, y, [120, 236, 255, 70]);
    }
  });

  const BEVEL = new Set([T.GRASS_TOP, T.GRASS_SIDE, T.DIRT, T.STONE, T.SAND, T.LOG_SIDE, T.LOG_TOP, T.LEAVES, T.PLANKS, T.BRICK, T.SNOW_TOP, T.SNOW_SIDE, T.CRYSTAL, T.BEDROCK, T.SLATE, T.QUARTZ]);

  /* ---------- 아틀라스 ---------- */
  function buildAtlas() {
    const cv = document.createElement('canvas');
    cv.width = COLS * TS; cv.height = ROWS * TS;
    const ctx = cv.getContext('2d');
    for (const key in P) {
      const t = +key, fn = P[key], img = ctx.createImageData(TS, TS), d = img.data;
      for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
        let c = fn(x, y);
        if (BEVEL.has(t)) {
          if (x === 0 || y === 0) c = mul(c, 1.045); else if (x === TS - 1 || y === TS - 1) c = mul(c, 0.935);
        }
        const o = (y * TS + x) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3] === undefined ? 255 : c[3];
      }
      ctx.putImageData(img, (t % COLS) * TS, Math.floor(t / COLS) * TS);
    }
    return cv;
  }

  /* ---------- 구름 텍스처 (타일링) ---------- */
  function buildCloud() {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(S, S), d = img.data;
    const L = (x, y, cell, seed) => {
      const n = S / cell, fx = x / cell, fy = y / cell, xi = Math.floor(fx), yi = Math.floor(fy), xf = fx - xi, yf = fy - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = a => ((a % n) + n) % n;
      const a = hs(w(xi), w(yi), seed), b = hs(w(xi + 1), w(yi), seed), c = hs(w(xi), w(yi + 1), seed), e = hs(w(xi + 1), w(yi + 1), seed);
      return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const n = L(x, y, 64, 301) * 0.55 + L(x, y, 32, 302) * 0.3 + L(x, y, 16, 303) * 0.15;
      const a = Math.max(0, Math.min(1, (n - 0.5) * 4.2));
      const o = (y * S + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; d[o + 3] = a * 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /* ---------- 아이콘 / 평균색 ---------- */
  let atlasCanvas = null;
  const iconCache = {}, colorCache = {};

  function tileXY(t) { return [(t % COLS) * TS, Math.floor(t / COLS) * TS]; }

  function makeIcon(id, size) {
    size = size || 48;
    const key = id + ':' + size;
    if (iconCache[key]) return iconCache[key];
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const info = INFO[id], atlas = atlasCanvas;
    const s = size / 48;
    if (info.plant) {
      const [sx, sy] = tileXY(info.tiles[2]);
      ctx.drawImage(atlas, sx, sy, TS, TS, size * 0.06, size * 0.06, size * 0.88, size * 0.88);
    } else {
      const dx = 17.3 * s, dy = 10 * s, cx = 24 * s, top = 6 * s;
      const face = (t, a, b, c, d, e, f, shadow) => {
        const [sx, sy] = tileXY(t);
        ctx.save(); ctx.setTransform(a, b, c, d, e, f);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(atlas, sx, sy, TS, TS, 0, 0, TS, TS);
        if (shadow) { ctx.fillStyle = 'rgba(8,10,24,' + shadow + ')'; ctx.fillRect(0, 0, TS, TS); }
        ctx.restore();
      };
      face(info.tiles[0], dx / TS, dy / TS, -dx / TS, dy / TS, cx, top, 0);
      face(info.tiles[2], dx / TS, dy / TS, 0, 20 * s / TS, cx - dx, top + dy, 0.2);
      face(info.tiles[2], dx / TS, -dy / TS, 0, 20 * s / TS, cx, top + 2 * dy, 0.38);
    }
    iconCache[key] = cv;
    return cv;
  }

  function avgColor(id) {
    if (colorCache[id]) return colorCache[id];
    const info = INFO[id], [sx, sy] = tileXY(info.tiles[2]);
    const d = atlasCanvas.getContext('2d').getImageData(sx, sy, TS, TS).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    n = n || 1;
    return (colorCache[id] = [r / n / 255, g / n / 255, b / n / 255]);
  }

  G.Blocks = {
    B, T, INFO, SOLID, OCC, TRANS, PLANT, EMIT, TARGET, PLACEABLE, DEFAULT_HOTBAR, COLS, ROWS, TS,
    init() { atlasCanvas = buildAtlas(); return atlasCanvas; },
    buildCloud, makeIcon, avgColor,
    tileUV(t) { return [(t % COLS) / COLS, Math.floor(t / COLS) / ROWS, 1 / COLS, 1 / ROWS]; }
  };
})(window.LUMINA = window.LUMINA || {});
