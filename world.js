/* ===========================================================
 * world.js — 무한 청크 월드
 *  - 시드 기반 지형(대륙/언덕/산), 바다, 동굴, 나무, 식물
 *  - 독창 요소: 하늘 위에 떠 있는 "공중섬" + 빛나는 "루미나 크리스탈"
 *  - 청크 생성/메싱을 프레임당 시간 예산(ms)으로 분할 처리
 *  - 면 컬링 + 정점 앰비언트 오클루전(AO) + 크리스탈 글로우
 * =========================================================== */
(function (G) {
  'use strict';
  const { B, INFO, SOLID, OCC, TRANS, PLANT, EMIT, TARGET } = G.Blocks;
  const { Noise, hash2, hash3, Mat } = G;

  const CS = 16, WH = 128, SEA = 32, PW = 18;
  const SX = PW * WH, SZ = WH;               // 패딩 배열에서 x, z 한 칸의 인덱스 간격

  /* ----- 면 테이블 ----- */
  const FN = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const FU = [[0, 1, 0], [0, 0, 1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [0, 1, 0]];
  const FV = [[0, 0, 1], [0, 1, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];
  const FSHADE = [0.86, 0.68, 1.0, 0.5, 0.78, 0.62];
  const toOff = v => v[0] * SX + v[2] * SZ + v[1];
  const FOFF = FN.map(toOff), FUOFF = FU.map(toOff), FVOFF = FV.map(toOff);
  const CORN = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const AO_T = [0.5, 0.68, 0.85, 1.0];
  // (u,v) → (s,t) 텍스처 좌표
  const UVMAP = [
    (u, v) => [1 - v, u], (u, v) => [u, v], (u, v) => [v, u], (u, v) => [u, v], (u, v) => [u, v], (u, v) => [1 - v, u]
  ];
  const EPS = 0.012;

  /* ----- 메시 버퍼 ----- */
  class MeshBuf {
    constructor(maxQuads) {
      this.v = new Float32Array(maxQuads * 4 * 8);
      this.i = new Uint32Array(maxQuads * 6);
      this.maxQ = maxQuads; this.nv = 0; this.ni = 0;
    }
    reset() { this.nv = 0; this.ni = 0; }
    get full() { return this.nv / 4 >= this.maxQ; }
    vert(x, y, z, u, v, a, b, c) {
      const o = this.nv * 8, d = this.v;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = u; d[o + 4] = v; d[o + 5] = a; d[o + 6] = b; d[o + 7] = c;
      return this.nv++;
    }
    tri(a, b, c) { this.i[this.ni++] = a; this.i[this.ni++] = b; this.i[this.ni++] = c; }
    quad(i0, flip) {
      if (flip) { this.tri(i0 + 1, i0 + 2, i0 + 3); this.tri(i0 + 1, i0 + 3, i0); }
      else { this.tri(i0, i0 + 1, i0 + 2); this.tri(i0, i0 + 2, i0 + 3); }
    }
    toMesh(gfx) {
      if (this.ni === 0) return null;
      return gfx.createMesh(this.v.slice(0, this.nv * 8), this.i.slice(0, this.ni));
    }
  }

  class World {
    constructor(seed, gfx) {
      this.seed = seed | 0; this.gfx = gfx;
      this.noise = new Noise(this.seed);
      this.tempN = new Noise(this.seed + 101);
      this.caveN1 = new Noise(this.seed + 202);
      this.caveN2 = new Noise(this.seed + 303);
      this.islN = new Noise(this.seed + 404);
      this.forestN = new Noise(this.seed + 505);
      this.chunks = new Map();
      this.R = 6;
      this.genList = []; this.meshList = []; this.genI = 0;
      this._pcx = 1e9; this._pcz = 1e9; this._listDirty = true;
      this._pad = new Uint8Array(PW * PW * WH);
      this.bufO = new MeshBuf(26000); this.bufG = new MeshBuf(5000); this.bufW = new MeshBuf(9000);
      this._lc = null; this._lk = -1;
      this.stats = { chunks: 0, meshed: 0, gen: 0 };
      this.editLog = new Map();   // "x,y,z" → 블록 (멀티플레이 동기화용 편집 기록)
      this.pending = new Map();   // 아직 생성되지 않은 청크에 대한 편집
      this.onEdit = null;
    }

    setRenderDistance(r) { this.R = Math.max(2, Math.min(24, r | 0)); this._listDirty = true; }
    key(cx, cz) { return (cx & 0xFFFF) * 65536 + (cz & 0xFFFF); }
    getChunk(cx, cz) { return this.chunks.get(this.key(cx, cz)); }

    /* ================= 지형 ================= */
    column(wx, wz) {
      const n = this.noise;
      const cont = n.fbm2(wx * 0.0034, wz * 0.0034, 4);
      const hills = n.fbm2(wx * 0.014 + 31.7, wz * 0.014 - 12.3, 4);
      let m = n.fbm2(wx * 0.0062 - 77, wz * 0.0062 + 54, 3) + 0.12; if (m < 0) m = 0;
      let h = Math.floor(35 + cont * 15 + hills * 6.5 + m * m * 95);
      if (h < 2) h = 2; if (h > 104) h = 104;
      const temp = this.tempN.fbm2(wx * 0.0022 + 200, wz * 0.0022 + 200, 2);
      let top, fill;
      const desert = temp > 0.22 && h < 64;
      const snowy = h >= 80 || (temp < -0.3 && h > SEA + 1);
      if (h < SEA - 1) { top = fill = (h >= SEA - 6 ? B.SAND : B.DIRT); }
      else if (h <= SEA + 1 || desert) { top = fill = B.SAND; }
      else if (snowy) { top = B.SNOW; fill = h >= 80 ? B.STONE : B.DIRT; }
      else if (h >= 70) { top = fill = B.STONE; }
      else { top = B.GRASS; fill = B.DIRT; }
      return { h, top, fill, temp };
    }
    heightAt(wx, wz) { return this.column(wx, wz).h; }

    islandAt(wx, wz) {
      const k = this.islN.fbm2(wx * 0.0085 + 400, wz * 0.0085 - 200, 3) - 0.30;
      if (k <= 0) return null;
      const top = 100 + Math.floor(this.noise.n2(wx * 0.045, wz * 0.045) * 2.2);
      const depth = Math.min(22, 3 + Math.floor(Math.sqrt(k) * 45));
      return { k, top, bottom: top - depth };
    }

    genChunk(cx, cz) {
      const data = new Uint8Array(CS * CS * WH);
      const ox = cx * CS, oz = cz * CS, seed = this.seed;
      const cols = new Array(CS * CS);
      let top = 0;

      for (let lx = 0; lx < CS; lx++) for (let lz = 0; lz < CS; lz++) {
        const wx = ox + lx, wz = oz + lz;
        const c = this.column(wx, wz); cols[lx * CS + lz] = c;
        const base = (lx * CS + lz) * WH, h = c.h;
        const entrance = h > SEA + 4 && this.caveN2.n2(wx * 0.03, wz * 0.03) > 0.5;
        const carveMax = entrance ? h : h - 3;
        for (let y = 0; y <= h; y++) {
          let b;
          if (y === 0) b = B.BEDROCK;
          else if (y === h) b = c.top;
          else if (y >= h - 3) b = c.fill;
          else b = y < 18 ? B.SLATE : B.STONE;
          if (y > 2 && y <= carveMax) {
            const n1 = this.caveN1.n3(wx * 0.05, y * 0.075, wz * 0.05);
            if (n1 < 0.1 && n1 > -0.1) {
              const n2 = this.caveN2.n3(wx * 0.05 + 37, y * 0.075 + 11, wz * 0.05 - 23);
              if (n2 < 0.1 && n2 > -0.1) b = B.AIR;
            }
          }
          data[base + y] = b;
        }
        if (h < SEA) for (let y = h + 1; y <= SEA; y++) data[base + y] = B.WATER;
        top = Math.max(top, h < SEA ? SEA : h);
      }

      // 동굴 벽의 루미나 크리스탈
      for (let lx = 1; lx < CS - 1; lx++) for (let lz = 1; lz < CS - 1; lz++) {
        const base = (lx * CS + lz) * WH, h = cols[lx * CS + lz].h, ymax = Math.min(h - 3, 72);
        for (let y = 3; y < ymax; y++) {
          const b = data[base + y];
          if (b !== B.STONE && b !== B.SLATE) continue;
          if (data[base + y + 1] === B.AIR || data[base + y - 1] === B.AIR || data[base + WH + y] === B.AIR || data[base - WH + y] === B.AIR ||
            data[base + CS * WH + y] === B.AIR || data[base - CS * WH + y] === B.AIR) {
            if (hash3(ox + lx, y, oz + lz, seed + 31) < 0.02) data[base + y] = B.CRYSTAL;
          }
        }
      }

      // 지표 식물
      for (let lx = 0; lx < CS; lx++) for (let lz = 0; lz < CS; lz++) {
        const c = cols[lx * CS + lz];
        if (c.top !== B.GRASS) continue;
        const idx = (lx * CS + lz) * WH + c.h + 1;
        if (data[idx] !== B.AIR) continue;
        const r = hash2(ox + lx, oz + lz, seed + 11);
        if (r < 0.1) data[idx] = B.TALLGRASS; else if (r < 0.114) data[idx] = B.FLOWER; else if (r < 0.1175) data[idx] = B.GLOWBLOOM;
      }

      const setL = (wx, y, wz, b, onlyAir) => {
        const lx = wx - ox, lz = wz - oz;
        if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || y < 0 || y >= WH) return;
        const i = (lx * CS + lz) * WH + y;
        if (onlyAir && data[i] !== B.AIR && !PLANT[data[i]]) return;
        data[i] = b; if (y > top) top = y;
      };

      // 공중섬
      for (let lx = 0; lx < CS; lx++) for (let lz = 0; lz < CS; lz++) {
        const wx = ox + lx, wz = oz + lz, isl = this.islandAt(wx, wz);
        if (!isl) continue;
        const base = (lx * CS + lz) * WH;
        for (let y = isl.bottom; y <= isl.top; y++) {
          if (data[base + y] !== B.AIR) continue;
          let b = y === isl.top ? B.GRASS : (y >= isl.top - 3 ? B.DIRT : (y <= isl.bottom + 1 ? B.SLATE : B.STONE));
          if (b === B.STONE && hash3(wx, y, wz, seed + 41) < 0.018) b = B.CRYSTAL;
          data[base + y] = b;
        }
        if (isl.top > top) top = isl.top;
        // 아래로 늘어진 크리스탈 고드름
        if (hash2(wx, wz, seed + 23) < 0.05) {
          const len = 2 + Math.floor(hash2(wx, wz, seed + 24) * 4);
          for (let i = 1; i <= len; i++) if (isl.bottom - i > 0 && data[base + isl.bottom - i] === B.AIR) data[base + isl.bottom - i] = B.CRYSTAL;
        }
        const r = hash2(wx, wz, seed + 12);
        const pi = base + isl.top + 1;
        if (data[pi] === B.AIR) { if (r < 0.1) data[pi] = B.TALLGRASS; else if (r < 0.14) data[pi] = B.FLOWER; else if (r < 0.2) data[pi] = B.GLOWBLOOM; }
      }

      // 나무 (이웃 청크 경계를 넘나드는 후보까지 결정적으로 계산)
      const sT = seed + 7;
      for (let wx = ox - 2; wx < ox + CS + 2; wx++) for (let wz = oz - 2; wz < oz + CS + 2; wz++) {
        const hv = hash2(wx, wz, sT);
        if (hv > 0.05) continue;
        let ok = true;
        for (let dx = -2; dx <= 2 && ok; dx++) for (let dz = -2; dz <= 2; dz++) if ((dx || dz) && hash2(wx + dx, wz + dz, sT) < hv) { ok = false; break; }
        if (!ok) continue;
        let gy = -1, dens;
        const isl = this.islandAt(wx, wz);
        if (isl && isl.k > 0.03) { gy = isl.top; dens = 0.012; }
        else {
          const c = this.column(wx, wz);
          if (c.top !== B.GRASS) continue;
          if (isl && isl.bottom <= c.h + 9) continue;
          gy = c.h; dens = this.forestN.n2(wx * 0.012, wz * 0.012) > 0.08 ? 0.05 : 0.006;
        }
        if (hv > dens) continue;
        const th = 4 + Math.floor(hash2(wx, wz, sT + 1) * 3);
        for (let i = 1; i <= th; i++) setL(wx, gy + i, wz, B.LOG, false);
        const layers = [[-2, 2], [-1, 2], [0, 1], [1, 1]];
        for (const [dy, r] of layers) {
          for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            const corner = Math.abs(dx) === r && Math.abs(dz) === r;
            if (corner && (r === 1 ? dy === 1 : hash3(wx + dx, gy + dy, wz + dz, sT + 2) < 0.55)) continue;
            setL(wx + dx, gy + th + dy, wz + dz, B.LEAVES, true);
          }
        }
      }

      return { cx, cz, data, mesh: null, top: Math.min(WH - 1, top), modified: false };
    }

    ensureChunk(cx, cz) {
      let c = this.getChunk(cx, cz);
      if (!c) {
        c = this.genChunk(cx, cz); this.chunks.set(this.key(cx, cz), c); this.stats.gen++;
        const pend = this.pending.get(this.key(cx, cz));
        if (pend) {
          for (let i = 0; i < pend.length; i += 4) {
            c.data[(pend[i] * CS + pend[i + 2]) * WH + pend[i + 1]] = pend[i + 3];
            if (pend[i + 1] > c.top) c.top = pend[i + 1];
          }
          c.modified = true; this.pending.delete(this.key(cx, cz));
        }
      }
      return c;
    }

    /* ================= 블록 접근 ================= */
    getBlock(x, y, z) {
      if (y < 0) return B.BEDROCK;
      if (y >= WH) return B.AIR;
      const cx = x >> 4, cz = z >> 4;
      let c = this._lc;
      if (!c || c.cx !== cx || c.cz !== cz) {
        c = this.chunks.get(this.key(cx, cz));
        if (!c) return B.STONE;          // 미로딩 구역은 단단한 벽으로 취급 (추락 방지)
        this._lc = c;
      }
      return c.data[((x & 15) * CS + (z & 15)) * WH + y];
    }
    isLoaded(x, z) { return this.chunks.has(this.key(x >> 4, z >> 4)); }

    setBlock(x, y, z, id, remote) {
      if (y < 1 || y >= WH) return false;
      const cx = x >> 4, cz = z >> 4, c = this.getChunk(cx, cz);
      this.editLog.set(x + ',' + y + ',' + z, id);
      if (!remote && this.onEdit) this.onEdit(x, y, z, id);
      if (!c) {
        const k = this.key(cx, cz); let a = this.pending.get(k);
        if (!a) { a = []; this.pending.set(k, a); }
        a.push(x & 15, y, z & 15, id); return true;
      }
      const lx = x & 15, lz = z & 15;
      c.data[(lx * CS + lz) * WH + y] = id; c.modified = true;
      if (y > c.top) c.top = y;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (dx === -1 && lx !== 0) continue; if (dx === 1 && lx !== 15) continue;
        if (dz === -1 && lz !== 0) continue; if (dz === 1 && lz !== 15) continue;
        const n = this.getChunk(cx + dx, cz + dz);
        if (n && n.mesh) this.meshChunk(n);
      }
      return true;
    }

    /** DDA 복셀 레이캐스트 */
    raycast(ox, oy, oz, dx, dy, dz, maxD) {
      let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
      const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
      let tx = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (ox - x) / -dx : Infinity;
      let ty = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (oy - y) / -dy : Infinity;
      let tz = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (oz - z) / -dz : Infinity;
      let nx = 0, ny = 0, nz = 0, t = 0;
      for (let i = 0; i < 160; i++) {
        const b = this.getBlock(x, y, z);
        if (TARGET[b]) return { x, y, z, nx, ny, nz, id: b, t };
        if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
        else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
        else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
        if (t > maxD) break;
      }
      return null;
    }

    /* ================= 청크 관리 ================= */
    _rebuildLists(pcx, pcz) {
      const R = this.R, gl = [], ml = [];
      const rg = (R + 1) * (R + 1) + 1, rm = R * R + R;
      for (let dx = -R - 1; dx <= R + 1; dx++) for (let dz = -R - 1; dz <= R + 1; dz++) {
        const d2 = dx * dx + dz * dz, cx = pcx + dx, cz = pcz + dz;
        const c = this.getChunk(cx, cz);
        if (d2 <= rg && !c) gl.push([cx, cz, d2]);
        if (d2 <= rm && (!c || !c.mesh)) ml.push([cx, cz, d2]);
      }
      gl.sort((a, b) => a[2] - b[2]); ml.sort((a, b) => a[2] - b[2]);
      this.genList = gl; this.meshList = ml; this.genI = 0;
      // 멀어진 청크 해제 (수정된 청크는 데이터 보존)
      const rd = (R + 2.5) * (R + 2.5);
      for (const [k, c] of this.chunks) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > rd) {
          if (c.mesh) { this._freeMesh(c); }
          if (!c.modified) { this.chunks.delete(k); if (this._lc === c) this._lc = null; }
        }
      }
    }
    _freeMesh(c) {
      const g = this.gfx; if (!c.mesh) return;
      g.deleteMesh(c.mesh.o); g.deleteMesh(c.mesh.g); g.deleteMesh(c.mesh.w); c.mesh = null;
    }

    update(px, pz, budgetMs) {
      const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
      if (pcx !== this._pcx || pcz !== this._pcz || this._listDirty) {
        this._pcx = pcx; this._pcz = pcz; this._listDirty = false; this._rebuildLists(pcx, pcz);
      }
      const t0 = performance.now();
      const gb = budgetMs * 0.5;
      while (this.genI < this.genList.length && performance.now() - t0 < gb) {
        const e = this.genList[this.genI++];
        if (!this.getChunk(e[0], e[1])) this.ensureChunk(e[0], e[1]);
      }
      const ml = this.meshList;
      for (let i = 0; i < ml.length && performance.now() - t0 < budgetMs; i++) {
        const e = ml[i], c = this.getChunk(e[0], e[1]);
        if (!c) continue;
        if (c.mesh) { ml.splice(i--, 1); continue; }
        if (this._neighborsReady(e[0], e[1])) { this.meshChunk(c); ml.splice(i--, 1); }
      }
      this.stats.chunks = this.chunks.size;
    }
    _neighborsReady(cx, cz) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (!this.getChunk(cx + dx, cz + dz)) return false;
      return true;
    }
    /** 목표 반경 안의 메시가 모두 준비되었는지 (로딩 화면용) */
    readyRatio(px, pz, r) {
      const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
      let n = 0, ok = 0;
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dz * dz > r * r + 1) continue;
        n++; const c = this.getChunk(pcx + dx, pcz + dz); if (c && c.mesh) ok++;
      }
      return ok / n;
    }

    /* ================= 메싱 ================= */
    meshChunk(ch) {
      const P = this._pad, WHs = WH;
      // 1) 18x18 패딩 복사
      for (let px = 0; px < PW; px++) for (let pz = 0; pz < PW; pz++) {
        const ncx = ch.cx + (px === 0 ? -1 : px === PW - 1 ? 1 : 0), ncz = ch.cz + (pz === 0 ? -1 : pz === PW - 1 ? 1 : 0);
        const lx = px === 0 ? 15 : px === PW - 1 ? 0 : px - 1, lz = pz === 0 ? 15 : pz === PW - 1 ? 0 : pz - 1;
        const src = (ncx === ch.cx && ncz === ch.cz) ? ch : this.getChunk(ncx, ncz);
        const pb = (px * PW + pz) * WHs;
        if (src) { const sb = (lx * CS + lz) * WHs; P.set(src.data.subarray(sb, sb + WHs), pb); }
        else P.fill(0, pb, pb + WHs);
      }
      const ymax = Math.min(WH - 1, ch.top + 1);

      // 2) 발광 블록 수집 (이웃 영역 포함)
      const lights = [];
      for (let px = 0; px < PW && lights.length < 150; px++) for (let pz = 0; pz < PW; pz++) {
        const pb = (px * PW + pz) * WHs;
        for (let y = 1; y <= ymax; y++) {
          const b = P[pb + y];
          if (b === B.CRYSTAL || b === B.GLOWBLOOM) lights.push(px - 1, y, pz - 1);
        }
      }
      const nl = lights.length / 3;
      const glowAt = (x, y, z) => {
        let g = 0;
        for (let i = 0; i < lights.length; i += 3) {
          const dx = x - lights[i] - 0.5, dy = y - lights[i + 1] - 0.5, dz = z - lights[i + 2] - 0.5;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 30) { const t = 1 - Math.sqrt(d2) / 5.5; g += t * t; }
        }
        return g > 1 ? 1 : g;
      };

      const bo = this.bufO, bg = this.bufG, bw = this.bufW;
      bo.reset(); bg.reset(); bw.reset();
      const aoV = [0, 0, 0, 0], gl4 = [0, 0, 0, 0];
      const U = Math.floor;
      const { INFO: INF } = G.Blocks;
      const tileUV = G.Blocks.tileUV;
      const wox = ch.cx * CS, woz = ch.cz * CS;

      for (let lx = 0; lx < CS; lx++) for (let lz = 0; lz < CS; lz++) {
        const pb = ((lx + 1) * PW + (lz + 1)) * WHs;
        for (let y = 0; y <= ymax; y++) {
          const b = P[pb + y];
          if (b === 0) continue;
          const idx = pb + y;
          const info = INF[b];

          /* 식물: 십자 평면 */
          if (PLANT[b]) {
            if (bo.full) continue;
            const [u0, v0, tw, th] = tileUV(info.tiles[2]);
            const rx = (hash2(wox + lx, woz + lz, 5) - 0.5) * 0.3, rz = (hash2(wox + lx, woz + lz, 6) - 0.5) * 0.3;
            const sh = 0.95, em = EMIT[b] ? 1 : 0;
            const planes = [[0.08, 0.08, 0.92, 0.92], [0.08, 0.92, 0.92, 0.08]];
            const gv = nl ? glowAt(lx + 0.5, y + 0.5, lz + 0.5) : 0;
            for (const [ax, az, bx, bz] of planes) {
              for (let side = 0; side < 2; side++) {
                const x0 = lx + rx + (side ? bx : ax), z0 = lz + rz + (side ? bz : az), x1 = lx + rx + (side ? ax : bx), z1 = lz + rz + (side ? az : bz);
                const i0 = bo.vert(x0, y, z0, u0 + EPS * tw, v0 + th * (1 - EPS), sh, em, gv);
                bo.vert(x1, y, z1, u0 + tw * (1 - EPS), v0 + th * (1 - EPS), sh, em, gv);
                bo.vert(x1, y + 1, z1, u0 + tw * (1 - EPS), v0 + th * EPS, sh, em, gv);
                bo.vert(x0, y + 1, z0, u0 + EPS * tw, v0 + th * EPS, sh, em, gv);
                bo.quad(i0, false);
              }
            }
            continue;
          }

          const isGlass = b === B.GLASS, isWater = b === B.WATER;
          const buf = isWater ? bw : (isGlass ? bg : bo);
          if (buf.full) continue;
          const waterLow = isWater && P[idx + 1] !== B.WATER;
          const emit = EMIT[b] ? 1 : 0;

          for (let f = 0; f < 6; f++) {
            if (f === 3 && y === 0) continue;
            const nb = (f === 2 && y === WH - 1) ? 0 : P[idx + FOFF[f]];
            let vis;
            if (isWater) vis = nb !== B.WATER && !OCC[nb];
            else if (isGlass) vis = nb !== B.GLASS && !OCC[nb];
            else vis = !OCC[nb];
            if (!vis) continue;

            const tile = f === 2 ? info.tiles[0] : f === 3 ? info.tiles[1] : info.tiles[2];
            const [u0, v0, tw, th] = tileUV(tile);
            const n = FN[f], uu = FU[f], vv = FV[f];
            const ox = n[0] > 0 ? 1 : 0, oy = n[1] > 0 ? 1 : 0, oz = n[2] > 0 ? 1 : 0;
            const ni = idx + FOFF[f], uo = FUOFF[f], vo = FVOFF[f], uvf = UVMAP[f];
            const fs = FSHADE[f];
            const useAO = !isWater;
            for (let k = 0; k < 4; k++) {
              const cu = CORN[k][0], cv = CORN[k][1];
              if (useAO) {
                const su = cu ? 1 : -1, sv = cv ? 1 : -1;
                const s1 = OCC[P[ni + su * uo]], s2 = OCC[P[ni + sv * vo]], c = OCC[P[ni + su * uo + sv * vo]];
                aoV[k] = (s1 && s2) ? 0 : 3 - (s1 + s2 + c);
              } else aoV[k] = 3;
              if (nl) {
                const px = lx + ox + cu * uu[0] + cv * vv[0], py = y + oy + cu * uu[1] + cv * vv[1], pz = lz + oz + cu * uu[2] + cv * vv[2];
                gl4[k] = glowAt(px, py, pz);
              } else gl4[k] = 0;
            }
            const i0 = buf.nv;
            for (let k = 0; k < 4; k++) {
              const cu = CORN[k][0], cv = CORN[k][1];
              let px = lx + ox + cu * uu[0] + cv * vv[0], py = y + oy + cu * uu[1] + cv * vv[1], pz = lz + oz + cu * uu[2] + cv * vv[2];
              if (waterLow && py === y + 1) py -= 0.12;
              const st = uvf(cu, cv);
              buf.vert(px, py, pz,
                u0 + tw * (EPS + st[0] * (1 - 2 * EPS)), v0 + th * (1 - (EPS + st[1] * (1 - 2 * EPS))),
                fs * AO_T[aoV[k]], emit, gl4[k]);
            }
            buf.quad(i0, aoV[0] + aoV[2] < aoV[1] + aoV[3]);
          }
        }
      }

      this._freeMesh(ch);
      ch.mesh = { o: bo.toMesh(this.gfx), g: bg.toMesh(this.gfx), w: bw.toMesh(this.gfx) };
      this.stats.meshed++;
    }

    /* ================= 렌더 ================= */
    /** 불투명 패스. 보이는 청크 목록을 반환 */
    drawOpaque(env, cam) {
      const gfx = this.gfx, pl = env.planes, vis = [];
      const maxD = (this.R + 1) * CS;
      for (const c of this.chunks.values()) {
        if (!c.mesh) continue;
        const x0 = c.cx * CS - cam.x, z0 = c.cz * CS - cam.z;
        const cxm = x0 + 8, czm = z0 + 8;
        if (cxm * cxm + czm * czm > maxD * maxD + 600) continue;
        if (!Mat.aabbVisible(pl, x0, -cam.y, z0, x0 + CS, c.top + 1 - cam.y, z0 + CS)) continue;
        vis.push({ c, x0, z0, d: cxm * cxm + czm * czm });
      }
      gfx.beginWorld(env); gfx.setWorldMode(0);
      for (const v of vis) if (v.c.mesh.o) gfx.drawChunk(v.c.mesh.o, v.x0, -cam.y, v.z0, v.c.cx * CS, v.c.cz * CS);
      return vis;
    }
    drawTranslucent(env, cam, vis) {
      const gfx = this.gfx;
      vis.sort((a, b) => b.d - a.d);
      gfx.beginWorld(env);
      gfx.setWorldMode(1);
      for (const v of vis) if (v.c.mesh.g) gfx.drawChunk(v.c.mesh.g, v.x0, -cam.y, v.z0, v.c.cx * CS, v.c.cz * CS);
      gfx.setWorldMode(2);
      for (const v of vis) if (v.c.mesh.w) gfx.drawChunk(v.c.mesh.w, v.x0, -cam.y, v.z0, v.c.cx * CS, v.c.cz * CS);
      gfx.setWorldMode(0);
    }

    /* ================= 스폰 ================= */
    findSpawn() {
      for (let r = 0; r < 600; r += 6) {
        const steps = Math.max(1, Math.floor(r / 6) * 3);
        for (let i = 0; i < steps; i++) {
          const a = (i / steps) * Math.PI * 2, x = Math.floor(8 + Math.cos(a) * r), z = Math.floor(8 + Math.sin(a) * r);
          const c = this.column(x, z);
          if (c.h >= SEA + 2 && c.h < 62 && c.top !== B.SNOW) {
            const ch = this.ensureChunk(x >> 4, z >> 4);
            let y = c.h + 1;
            for (; y < WH - 3; y++) {
              if (ch.data[((x & 15) * CS + (z & 15)) * WH + y] === B.AIR && ch.data[((x & 15) * CS + (z & 15)) * WH + y + 1] === B.AIR) break;
            }
            return { x: x + 0.5, y, z: z + 0.5 };
          }
        }
      }
      return { x: 8.5, y: 90, z: 8.5 };
    }

    dispose() { for (const c of this.chunks.values()) this._freeMesh(c); this.chunks.clear(); }
  }

  G.World = World;
  G.WORLD = { CS, WH, SEA };
})(window.LUMINA = window.LUMINA || {});
