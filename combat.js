/* ===========================================================
 * combat.js — PvP: 검(근접) · 활(화살) · 폭탄 · 갑옷
 *  - 공격하는 쪽이 판정하고 피해는 맞는 쪽이 받는다 (갑옷 감쇄는 맞는 쪽에서 계산)
 *  - 화살/폭탄은 던진 사람이 물리를 계산해 맞았을 때만 'hit'을 보내고,
 *    다른 사람들은 같은 궤적을 눈으로만 시뮬레이션한다
 *  - 폭발은 'boom' 메시지 하나로 모든 클라이언트가 같은 크레이터를 만든다 (결정적 해시)
 * =========================================================== */
(function (G) {
  'use strict';
  const { Mat, Blocks, Net, ITEM, hash3 } = G;
  const { B, SOLID, INFO, PLANT } = Blocks;

  const REDUCE = {}; REDUCE[ITEM.ARMOR_IRON] = 0.3; REDUCE[ITEM.ARMOR_CRYSTAL] = 0.5;
  const SWORD_DMG = 6, ARROW_DMG = 5, REACH = 3.4, BOMB_R = 3.4, BOMB_DMG_R = 5.6, BOMB_DMG = 18;

  function rayAABB(ox, oy, oz, dx, dy, dz, mn, mx) {
    let t0 = 0, t1 = 1e9;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return -1; continue; }
      let a = (mn[i] - o[i]) / d[i], b = (mx[i] - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1;
    }
    return t0;
  }

  const Combat = {
    arrows: [], bombs: [], cd: { melee: 0, bow: 0, bomb: 0 }, armor: 0, lastHit: null, ctx: null, uid: 0,
    init(ctx) { this.ctx = ctx; },
    reduction() { return REDUCE[this.armor] || 0; },
    reset() { this.arrows.length = 0; this.bombs.length = 0; this.lastHit = null; },

    /* ---------- 사용 ---------- */
    /** 검: 좌클릭 유지. 사거리 안에 플레이어가 있으면 true(블록은 부수지 않음) */
    melee(breakHeld, dt) {
      if (!breakHeld || !Net.active) return false;
      const L = this.ctx.look(), w = this.ctx.world();
      const blk = w.raycast(L.x, L.y, L.z, L.dx, L.dy, L.dz, REACH + 0.5);
      const maxT = Math.min(REACH, blk ? blk.t : 99);
      let best = null, bt = 1e9;
      for (const p of Net.players.values()) {
        if (!p.init || p.hp <= 0) continue;
        const t = rayAABB(L.x, L.y, L.z, L.dx, L.dy, L.dz, [p.x - 0.35, p.y, p.z - 0.35], [p.x + 0.35, p.y + 1.85, p.z + 0.35]);
        if (t >= 0 && t <= maxT && t < bt) { best = p; bt = t; }
      }
      if (!best) return false;
      if (this.cd.melee <= 0) {
        this.cd.melee = 0.45; this.ctx.swing(); this.ctx.sfx('swing');
        const hl = Math.hypot(L.dx, L.dz) || 1;
        this.sendHit(best, SWORD_DMG, L.dx / hl * 7, L.dz / hl * 7);
        this.ctx.burst(best.x, best.y + 1.2, best.z, [1, 0.25, 0.3], 10, 3);
      }
      return true;
    },
    sendHit(p, dmg, kx, kz) {
      if (!Net.active) return;
      Net.sendTo(p.id, { t: 'hit', to: p.id, dmg, kx, kz, by: this.ctx.myName() });
    },

    use(held, dt) {
      if (held === ITEM.BOW) this.shoot();
      else if (held === ITEM.BOMB) this.throwBomb();
      else if (held === ITEM.ARMOR_IRON || held === ITEM.ARMOR_CRYSTAL) this.equip(held);
    },
    equip(id) {
      this.armor = this.armor === id ? 0 : id;
      this.ctx.toast(this.armor ? G.Items.name(id) + ' 착용 (받는 피해 -' + Math.round(REDUCE[id] * 100) + '%)' : '갑옷을 벗었어요');
      this.ctx.sfx('click');
    },
    shoot() {
      if (this.cd.bow > 0) return; this.cd.bow = 0.55;
      const L = this.ctx.look(), a = { uid: ++this.uid, own: Net.myId || 'me', x: L.x + L.dx * 0.6, y: L.y + L.dy * 0.6 - 0.1, z: L.z + L.dz * 0.6, vx: L.dx * 34, vy: L.dy * 34, vz: L.dz * 34, life: 6, stuck: false, remote: false };
      this.arrows.push(a); this.ctx.sfx('bow'); this.ctx.swing();
      if (Net.active) Net.emit({ t: 'proj', k: 'arrow', x: a.x, y: a.y, z: a.z, vx: a.vx, vy: a.vy, vz: a.vz, own: a.own });
    },
    throwBomb() {
      if (this.cd.bomb > 0) return; this.cd.bomb = 0.8;
      const L = this.ctx.look(), b = { uid: this.myUid(), own: Net.myId || 'me', x: L.x + L.dx * 0.7, y: L.y + L.dy * 0.7 - 0.2, z: L.z + L.dz * 0.7, vx: L.dx * 14, vy: L.dy * 14 + 3.5, vz: L.dz * 14, fuse: 2.2, remote: false };
      this.bombs.push(b); this.ctx.sfx('fuse'); this.ctx.swing();
      if (Net.active) Net.emit({ t: 'proj', k: 'bomb', uid: b.uid, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, own: b.own });
    },
    myUid() { return (Net.myId || 'me') + '#' + (++this.uid); },

    /* ---------- 원격 투사체 수신 ---------- */
    onProj(m) {
      if (m.k === 'arrow') this.arrows.push({ uid: 0, own: m.own, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, life: 6, stuck: false, remote: true });
      else if (m.k === 'bomb') this.bombs.push({ uid: m.uid, own: m.own, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, fuse: 2.2, remote: true });
    },

    /* ---------- 시뮬레이션 ---------- */
    update(dt) {
      const w = this.ctx.world(); if (!w) return;
      for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
      // 화살
      for (let i = this.arrows.length - 1; i >= 0; i--) {
        const a = this.arrows[i]; a.life -= dt;
        if (a.life <= 0) { this.arrows.splice(i, 1); continue; }
        if (a.stuck) continue;
        const sp = Math.hypot(a.vx, a.vy, a.vz), steps = Math.max(1, Math.ceil(sp * dt / 0.35)), h = dt / steps;
        for (let s = 0; s < steps; s++) {
          a.vy -= 16 * h; a.x += a.vx * h; a.y += a.vy * h; a.z += a.vz * h;
          if (SOLID[w.getBlock(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z))]) { a.stuck = true; a.life = 3; this.ctx.sfx('click'); break; }
          if (!a.remote && Net.active) {
            let hit = null;
            for (const p of Net.players.values()) {
              if (!p.init || p.hp <= 0 || p.id === a.own) continue;
              if (a.x > p.x - 0.5 && a.x < p.x + 0.5 && a.z > p.z - 0.5 && a.z < p.z + 0.5 && a.y > p.y - 0.1 && a.y < p.y + 1.95) { hit = p; break; }
            }
            if (hit) {
              const l = Math.hypot(a.vx, a.vz) || 1;
              this.sendHit(hit, ARROW_DMG, a.vx / l * 4, a.vz / l * 4); this.ctx.burst(a.x, a.y, a.z, [1, 0.25, 0.3], 8, 3);
              this.arrows.splice(i, 1); break;
            }
          }
        }
      }
      // 폭탄
      for (let i = this.bombs.length - 1; i >= 0; i--) {
        const b = this.bombs[i]; b.fuse -= dt;
        const solid = (x, y, z) => SOLID[w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))];
        b.vy -= 26 * dt;
        let nx = b.x + b.vx * dt; if (solid(nx, b.y, b.z)) b.vx *= -0.4; else b.x = nx;
        let nz = b.z + b.vz * dt; if (solid(b.x, b.y, nz)) b.vz *= -0.4; else b.z = nz;
        let ny = b.y + b.vy * dt;
        if (solid(b.x, ny - 0.1, b.z) && b.vy < 0) { b.vy = Math.abs(b.vy) > 2.5 ? -b.vy * 0.35 : 0; b.vx *= 0.7; b.vz *= 0.7; } else if (solid(b.x, ny + 0.1, b.z) && b.vy > 0) b.vy = 0; else b.y = ny;
        if (b.fuse <= 0 && !b.remote) {
          this.bombs.splice(i, 1);
          const m = { t: 'boom', uid: b.uid, x: b.x, y: b.y, z: b.z, by: this.ctx.myName() };
          this.boom(m); if (Net.active) Net.emit(m);
        } else if (b.remote && b.fuse < -2) this.bombs.splice(i, 1);
      }
    },

    /* ---------- 폭발 (모든 클라이언트 동일) ---------- */
    boom(m) {
      const w = this.ctx.world(), P = this.ctx.player();
      for (let i = this.bombs.length - 1; i >= 0; i--) if (this.bombs[i].uid === m.uid) this.bombs.splice(i, 1);
      const R = BOMB_R, x0 = Math.floor(m.x), y0 = Math.floor(m.y), z0 = Math.floor(m.z);
      for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) {
        const d2 = dx * dx + dy * dy + dz * dz, x = x0 + dx, y = y0 + dy, z = z0 + dz;
        if (d2 > R * R * (0.8 + 0.4 * hash3(x, y, z, 77))) continue;
        const b = w.getBlock(x, y, z);
        if (b === B.AIR || b === B.WATER || INFO[b].unbreakable) continue;
        if (y < 1) continue;
        w.setBlock(x, y, z, B.AIR, true, true);
      }
      for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -4; dy <= 5; dy++) {
        const x = x0 + dx, y = y0 + dy, z = z0 + dz;
        if (PLANT[w.getBlock(x, y, z)] && !SOLID[w.getBlock(x, y - 1, z)]) w.setBlock(x, y, z, B.AIR, true, true);
      }
      w.flushDirty();
      this.ctx.burst(m.x, m.y, m.z, [1, 0.62, 0.18], 26, 9); this.ctx.burst(m.x, m.y, m.z, [0.35, 0.35, 0.4], 22, 7);
      this.ctx.sfx('boom');
      const d = Math.hypot(P.x - m.x, P.y + 0.9 - m.y, P.z - m.z);
      this.ctx.shake(Math.max(0, 0.7 * (1 - d / 22)));
      if (d < BOMB_DMG_R && !P.dead && P.invuln <= 0) {
        const k = 1 - d / BOMB_DMG_R, raw = Math.round(BOMB_DMG * Math.pow(k, 1.2));
        if (raw > 0) {
          const l = Math.hypot(P.x - m.x, P.z - m.z) || 1;
          P.vx += (P.x - m.x) / l * 12 * k; P.vz += (P.z - m.z) / l * 12 * k; P.vy = Math.max(P.vy, 7 * k + 3); P.onGround = false;
          this.lastHit = { by: m.by || '폭탄', t: this.ctx.time() };
          P.damage(Math.max(1, Math.round(raw * (1 - this.reduction()))));
        }
      }
    },

    /* ---------- 피격 ---------- */
    takeHit(m) {
      const P = this.ctx.player();
      if (P.dead || P.invuln > 0) return;
      this.lastHit = { by: m.by, t: this.ctx.time() };
      P.vx += m.kx || 0; P.vz += m.kz || 0; P.vy = Math.max(P.vy, 5); P.onGround = false;
      P.damage(Math.max(1, Math.round(m.dmg * (1 - this.reduction()))));
      this.ctx.sfx('hit');
    },

    /* ---------- 렌더 ---------- */
    draw(gfx, cam) {
      for (const a of this.arrows) {
        const sp = Math.hypot(a.vx, a.vy, a.vz) || 1, dx = a.vx / sp, dy = a.vy / sp, dz = a.vz / sp;
        const yaw = Math.atan2(-dx, -dz), pitch = Math.asin(Math.max(-1, Math.min(1, dy)));
        const M = Mat.mul(Mat.trans(a.x - cam.x, a.y - cam.y, a.z - cam.z), Mat.mul(Mat.rotY(yaw), Mat.rotX(pitch)));
        gfx.drawBox(M, 0.035, 0.035, 0.7, [0.62, 0.45, 0.28], 0);
        gfx.drawBox(Mat.mul(M, Mat.trans(0, 0, -0.38)), 0.07, 0.07, 0.1, [0.85, 0.92, 1], 0.4);
        gfx.drawBox(Mat.mul(M, Mat.trans(0, 0, 0.32)), 0.1, 0.1, 0.06, [1, 0.35, 0.4], 0.3);
      }
      for (const b of this.bombs) {
        const blink = Math.sin(b.fuse * (10 + (2.2 - Math.max(0, b.fuse)) * 12)) > 0;
        const M = Mat.trans(b.x - cam.x, b.y - cam.y, b.z - cam.z);
        gfx.drawBox(M, 0.34, 0.34, 0.34, blink ? [0.9, 0.2, 0.15] : [0.13, 0.14, 0.2], blink ? 0.8 : 0);
        gfx.drawBox(Mat.mul(M, Mat.trans(0, 0.22, 0)), 0.06, 0.12, 0.06, [1, 0.6, 0.15], 1);
      }
    }
  };

  G.Combat = Combat;
})(window.LUMINA = window.LUMINA || {});
