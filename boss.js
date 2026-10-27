/* ===========================================================
 * boss.js — 30분마다 열리는 보스전 "수정 군주"
 *  - 시간표는 실제 시계(Date.now) 기준이라 서버 없이도 모두가 같은 때에 열린다
 *  - 시작 1분 전에 초대 카드 → 참여한 사람만 전용 아레나(하늘 위 원형 제단)로 이동
 *  - 보스는 방장(혼자면 자기 자신)이 계산해서 상태를 뿌리고, 발사체·충격파는 이벤트로 모두가 똑같이 그린다
 *  - 피해는 맞는 사람이 스스로 계산(갑옷 적용), 보스에 대한 공격은 방장에게 'bhit'로 보낸다
 * =========================================================== */
(function (G) {
  'use strict';
  const { Mat, Blocks, Net, CONFIG } = G;
  const { B } = Blocks;
  const A = CONFIG.boss.arena, FLOOR = A.y + 1, R = 24, CS = 16, WH = 128;
  const q = /[?&]bossperiod=(\d+)/.exec(location.search);
  const P = q ? (+q[1]) * 1000 : CONFIG.boss.periodMin * 60000;
  const INV = Math.min(CONFIG.boss.inviteSec * 1000, P / 2), DUR = CONFIG.boss.durationSec * 1000;
  const CX = A.x + 0.5, CZ = A.z + 0.5;
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ---------- 아레나 지형 (청크 생성 때 결정적으로 새겨 넣음 → 네트워크 전송량 0) ---------- */
  const Arena = {
    y: A.y, cx: CX, cz: CZ, R, floor: FLOOR,
    contains(x, z, pad) { const d = Math.hypot(x - CX, z - CZ); return d <= R + (pad || 0); },
    stamp(data, ox, oz, top) {
      if (ox + 16 < CX - 60 || ox > CX + 60 || oz + 16 < CZ - 60 || oz > CZ + 60) return top;
      let t = top;
      for (let lx = 0; lx < CS; lx++) for (let lz = 0; lz < CS; lz++) {
        const wx = ox + lx, wz = oz + lz, d = Math.hypot(wx + 0.5 - CX, wz + 0.5 - CZ);
        if (d > 56) continue;
        const base = (lx * CS + lz) * WH;
        for (let y = 1; y < WH; y++) data[base + y] = B.AIR;
        if (d > R) continue;
        const depth = Math.floor((R - d) / 3.1), Y = A.y;
        for (let y = Y - 1 - depth; y < Y; y++) data[base + y] = B.SLATE;
        let top1 = B.SLATE;
        if (d <= 2.8 || d >= R - 1) top1 = B.CRYSTAL;
        else if ((d > 10.4 && d < 11.6) || (d > 16.4 && d < 17.2)) top1 = B.QUARTZ;
        else if (((wx + wz) & 1) === 0 && d > 3.5 && d < 9.5) top1 = B.QUARTZ;
        data[base + Y] = top1;
        for (let k = 0; k < 8; k++) {
          const px = Math.floor(CX + 19 * Math.cos(k * Math.PI / 4)), pz = Math.floor(CZ + 19 * Math.sin(k * Math.PI / 4));
          if (wx === px && wz === pz) { for (let y = Y + 1; y <= Y + 8; y++) data[base + y] = B.QUARTZ; data[base + Y + 9] = B.CRYSTAL; }
        }
        t = Math.max(t, Y + 10);
      }
      return t;
    }
  };
  G.Arena = Arena;

  /* ---------- 보스 ---------- */
  const Boss = {
    ev: null, phase: 'idle', joined: false, declined: false, inFight: false, b: null, fbs: [], slams: [], joinedIds: new Set(),
    ctx: null, syncT: 0, atk: [3, 7, 9], lastSeen: 0, fightStart: 0, P, INV, DUR, wins: 0,
    init(ctx) { this.ctx = ctx; },
    auth() { return !Net.active || Net.isHost; },
    nextT0() { return Math.ceil((Date.now() + 1) / P) * P; },

    schedule(t0) {
      if (this.inFight) return;
      this.ev = { t0 }; this.phase = 'idle'; this.joined = false; this.declined = false; this.joinedIds.clear(); this.b = null;
      this.ctx.hideInvite(); this.ctx.chat('보스전이 ' + Math.max(1, Math.round((t0 - Date.now()) / 1000)) + '초 뒤 열려요!');
    },
    status() {
      if (!this.ev) return { k: 'idle', s: Math.max(0, Math.round((this.nextT0() - Date.now()) / 1000)) };
      const u = Math.round((this.ev.t0 - Date.now()) / 1000);
      if (this.phase === 'fight') return { k: 'fight', s: Math.max(0, Math.round((DUR - (Date.now() - this.ev.t0)) / 1000)) };
      return { k: this.phase, s: Math.max(0, u) };
    },
    accept() {
      if (this.phase !== 'invite' || this.joined) return;
      this.joined = true; this.declined = false;
      if (this.auth()) this.joinedIds.add(Net.myId || 'me'); else Net.sendTo('host', { t: 'bjoin' });
      this.ctx.hideInvite(); this.ctx.toast('참여 확정! 시작되면 아레나로 이동해요', 3500);
    },
    decline() { this.declined = true; this.ctx.hideInvite(); this.ctx.toast('이번 보스전은 패스했어요 (상단 보스 타이머를 누르면 다시 참여할 수 있어요)', 3500); },

    tick(dt) {
      const n = Date.now();
      if (!this.ev) this.ev = { t0: this.nextT0() };
      const until = this.ev.t0 - n;
      if (this.phase === 'idle') {
        if (until <= INV && until > 2500) { this.phase = 'invite'; this.ctx.invite(); }
        else if (until <= 2500) { if (until <= 0) this.ev = { t0: this.nextT0() }; }
      } else if (this.phase === 'invite') {
        if (until <= 0) this.start();
      } else if (this.phase === 'fight') {
        if (n - this.ev.t0 > DUR + 2000 && this.auth()) this.end(false, '시간 초과');
        else if (this.b && !this.auth() && performance.now() - this.lastSeen > 9000) this.finish(false, '보스와 연결이 끊겨 전투가 종료됐어요');
      }
      this.update(dt);
    },

    start() {
      this.phase = 'fight'; this.fightStart = performance.now(); this.lastSeen = performance.now();
      this.ctx.hideInvite();
      if (this.joined) this.enter();
      if (this.auth()) {
        const cnt = this.joinedIds.size;
        if (cnt > 0) this.spawn(cnt); else { this.finish(false, '참여자가 없어 보스전이 취소됐어요'); }
      }
    },
    spawn(cnt) {
      const hp = 400 + 300 * cnt;
      this.b = { x: CX, y: FLOOR + 3, z: CZ, hp, max: hp, ph: 1, yaw: 0, hitT: 0, t: 0, tx: CX, ty: FLOOR + 3, tz: CZ };
      this.atk = [3.5, 8, 10]; this.fbs = []; this.slams = [];
      Net.active && Net.emit({ t: 'bev', k: 'spawn' });
      this.ctx.banner('수정 군주 출현!');
    },
    enter() {
      this.inFight = true;
      const a = rnd(0, Math.PI * 2), r = rnd(8, 12);
      this.ctx.enterArena(CX + Math.cos(a) * r, FLOOR, CZ + Math.sin(a) * r);
    },
    arenaSpawn() { const a = rnd(0, Math.PI * 2), r = rnd(6, 12); return { x: CX + Math.cos(a) * r, y: FLOOR, z: CZ + Math.sin(a) * r }; },

    end(win, why) { if (this.auth() && Net.active) Net.emit({ t: 'bev', k: 'end', win: win ? 1 : 0, why: why || '' }); this.finish(win, why); },
    finish(win, why) {
      const was = this.inFight, joined = this.joined;
      this.b = null; this.fbs = []; this.slams = []; this.inFight = false; this.phase = 'idle'; this.joined = false; this.declined = false;
      this.joinedIds.clear(); this.ev = { t0: this.nextT0() };
      this.ctx.hideInvite(); this.ctx.hideBar();
      if (win && joined) this.ctx.reward(); else if (joined || was) this.ctx.banner(why || '보스를 놓쳤어요… 다음 기회에!');
      else if (why) this.ctx.chat(why);
      if (was) this.ctx.leaveArena();
    },

    /* ---------- 공격 받기 / 히트박스 ---------- */
    hitbox() { const b = this.b; return b ? { mn: [b.x - 1.5, b.y - 1.5, b.z - 1.5], mx: [b.x + 1.5, b.y + 1.5, b.z + 1.5] } : null; },
    hit(dmg) {
      if (!this.b || !this.inFight) return;
      if (this.auth()) this.applyDmg(dmg); else Net.sendTo('host', { t: 'bhit', dmg: Math.min(40, Math.max(1, dmg | 0)) });
    },
    applyDmg(d) {
      const b = this.b; if (!b || this.phase !== 'fight') return;
      b.hp = Math.max(0, b.hp - d); b.hitT = 0.14;
      if (b.hp <= 0) { this.ctx.burst(b.x, b.y, b.z, [0.8, 0.5, 1], 40, 9); this.end(true); }
    },

    /* ---------- 네트워크 이벤트 ---------- */
    onEvent(m) {
      if (m.t === 'bhit') { if (this.auth()) this.applyDmg(Math.min(40, +m.dmg || 0)); return; }
      if (m.t === 'bjoin') { if (this.auth()) this.joinedIds.add(m.from); return; }
      if (m.t === 'boss') {
        this.lastSeen = performance.now();
        if (!this.b) this.b = { x: m.x, y: m.y, z: m.z, hp: m.hp, max: m.max, ph: m.ph, yaw: 0, hitT: 0, t: 0 };
        const b = this.b; b.tx = m.x; b.ty = m.y; b.tz = m.z; b.hp = m.hp; b.max = m.max; b.ph = m.ph; b.tyaw = m.yaw;
        return;
      }
      if (m.t !== 'bev') return;
      switch (m.k) {
        case 'sched': this.schedule(m.t0); break;
        case 'spawn': if (this.inFight) this.ctx.banner('수정 군주 출현!'); break;
        case 'fb': this.fbs.push({ x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, life: 7, dmg: m.dmg || 4 }); break;
        case 'ring': for (let i = 0; i < m.n; i++) { const a = i / m.n * Math.PI * 2 + m.off; this.fbs.push({ x: m.x, y: m.y, z: m.z, vx: Math.cos(a) * 9, vy: 0, vz: Math.sin(a) * 9, life: 5, dmg: 5 }); } break;
        case 'slam': this.slams.push({ x: m.x, z: m.z, r: m.r, t: m.d, d: m.d, done: false }); this.ctx.sfx('fuse'); break;
        case 'phase': if (this.inFight) this.ctx.banner(m.ph === 2 ? '수정 군주가 분노한다!' : '최후의 폭주!'); break;
        case 'end': this.finish(!!m.win, m.why); break;
      }
    },

    /* ---------- 시뮬레이션 ---------- */
    update(dt) {
      const b = this.b;
      if (b) {
        b.hitT = Math.max(0, b.hitT - dt);
        if (this.auth() && this.phase === 'fight') this.ai(b, dt);
        else if (b.tx !== undefined) {
          const k = Math.min(1, dt * 10);
          b.x += (b.tx - b.x) * k; b.y += (b.ty - b.y) * k; b.z += (b.tz - b.z) * k;
          let dy = (b.tyaw || 0) - b.yaw; while (dy > Math.PI) dy -= 6.283; while (dy < -Math.PI) dy += 6.283; b.yaw += dy * k;
        }
        if (this.inFight) this.ctx.bar(b.hp, b.max);
      }
      // 발사체
      const Pl = this.ctx.player();
      for (let i = this.fbs.length - 1; i >= 0; i--) {
        const f = this.fbs[i]; f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        if (f.life <= 0 || f.y < FLOOR - 0.2 || Math.hypot(f.x - CX, f.z - CZ) > 40) { if (f.y < FLOOR - 0.2) this.ctx.burst(f.x, FLOOR, f.z, [1, 0.5, 0.2], 6, 3); this.fbs.splice(i, 1); continue; }
        if (this.inFight && !Pl.dead && Math.hypot(f.x - Pl.x, f.y - (Pl.y + 0.9), f.z - Pl.z) < 0.95) {
          this.ctx.burst(f.x, f.y, f.z, [1, 0.5, 0.2], 10, 4); this.ctx.hurt(f.dmg, f.vx, f.vz); this.fbs.splice(i, 1);
        }
      }
      // 충격파
      for (let i = this.slams.length - 1; i >= 0; i--) {
        const s = this.slams[i]; s.t -= dt;
        if (s.t <= 0 && !s.done) {
          s.done = true; this.ctx.sfx('boom'); this.ctx.shake(0.35);
          this.ctx.burst(s.x, FLOOR + 0.3, s.z, [1, 0.4, 0.3], 24, 7);
          if (this.inFight && !Pl.dead) {
            const d = Math.hypot(Pl.x - s.x, Pl.z - s.z);
            if (d < s.r && Pl.y - FLOOR < 0.9) { const l = d || 1; this.ctx.hurt(7, (Pl.x - s.x) / l * 8, (Pl.z - s.z) / l * 8); }
            else if (d < s.r) this.ctx.toast('회피 성공!', 900);
          }
        }
        if (s.t < -0.5) this.slams.splice(i, 1);
      }
    },

    targets() {
      const out = [], P0 = this.ctx.player();
      if (this.inFight && !P0.dead) out.push({ x: P0.x, y: P0.y, z: P0.z });
      for (const p of Net.players.values()) if (p.init && p.hp > 0 && Math.hypot(p.x - CX, p.z - CZ) < 40 && p.y > A.y - 6) out.push({ x: p.x, y: p.y, z: p.z });
      return out;
    },
    ai(b, dt) {
      b.t += dt;
      const ph = b.hp / b.max > 0.66 ? 1 : b.hp / b.max > 0.33 ? 2 : 3;
      if (ph !== b.ph) { b.ph = ph; Net.active && Net.emit({ t: 'bev', k: 'phase', ph }); if (this.inFight) this.ctx.banner(ph === 2 ? '수정 군주가 분노한다!' : '최후의 폭주!'); }
      const T = this.targets();
      let near = null, nd = 1e9;
      for (const t of T) { const d = Math.hypot(t.x - b.x, t.z - b.z); if (d < nd) { nd = d; near = t; } }
      if (near) {
        const dx = near.x - b.x, dz = near.z - b.z, d = Math.hypot(dx, dz) || 1, want = 4.2, sp = (2.4 + ph * 0.9) * dt;
        if (d > want) { b.x += dx / d * sp; b.z += dz / d * sp; }
        b.yaw += (() => { let a = Math.atan2(-dx, -dz) - b.yaw; while (a > Math.PI) a -= 6.283; while (a < -Math.PI) a += 6.283; return a; })() * Math.min(1, dt * 4);
        const ex = b.x - CX, ez = b.z - CZ, ed = Math.hypot(ex, ez); if (ed > R - 4) { b.x = CX + ex / ed * (R - 4); b.z = CZ + ez / ed * (R - 4); }
      }
      b.y = FLOOR + 2.8 + Math.sin(b.t * 1.4) * 0.6;
      const emit = m => { Net.active && Net.emit(m); this.onEvent(m); };
      // 화염구
      this.atk[0] -= dt;
      if (this.atk[0] <= 0 && T.length) {
        this.atk[0] = [2.6, 1.9, 1.5][ph - 1];
        const t = T[Math.floor(Math.random() * T.length)], dx = t.x - b.x, dy = t.y + 1 - b.y, dz = t.z - b.z, l = Math.hypot(dx, dy, dz) || 1;
        const ang = ph >= 2 ? [-0.24, 0, 0.24] : [0];
        for (const a of ang) {
          const c = Math.cos(a), s = Math.sin(a), vx = (dx * c - dz * s) / l * 15, vz = (dx * s + dz * c) / l * 15;
          emit({ t: 'bev', k: 'fb', x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), vx: +vx.toFixed(2), vy: +(dy / l * 15).toFixed(2), vz: +vz.toFixed(2), dmg: ph === 3 ? 5 : 4 });
        }
        this.ctx.sfx('bow');
      }
      // 충격파
      this.atk[1] -= dt;
      if (this.atk[1] <= 0 && T.length) { this.atk[1] = [9, 7, 5.5][ph - 1]; emit({ t: 'bev', k: 'slam', x: +b.x.toFixed(2), z: +b.z.toFixed(2), r: ph === 3 ? 9.5 : 8, d: 1.5 }); }
      // 폭주 링
      if (ph === 3) { this.atk[2] -= dt; if (this.atk[2] <= 0 && T.length) { this.atk[2] = 8; emit({ t: 'bev', k: 'ring', x: +b.x.toFixed(2), y: FLOOR + 1.1, z: +b.z.toFixed(2), n: 12, off: +(Math.random() * 6).toFixed(2) }); } }
      this.syncT -= dt;
      if (this.syncT <= 0) { this.syncT = 0.1; Net.active && Net.emit({ t: 'boss', x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), hp: Math.round(b.hp), max: b.max, ph: b.ph, yaw: +b.yaw.toFixed(2) }); }
    },

    /* ---------- 그리기 ---------- */
    draw(gfx, cam, time) {
      if (!this.inFight) return;
      const T = Mat.trans, mul = Mat.mul;
      for (const s of this.slams) {
        const prog = Math.max(0, Math.min(1, 1 - s.t / s.d)), N = 30;
        for (let i = 0; i < N; i++) {
          const a = i / N * Math.PI * 2;
          gfx.drawBox(mul(T(s.x - cam.x + Math.cos(a) * s.r, FLOOR + 0.06 - cam.y, s.z - cam.z + Math.sin(a) * s.r), Mat.rotY(-a)), 0.2, 0.08, 1.4, [1, 0.25, 0.2], 0.9, 0.85);
          gfx.drawBox(mul(T(s.x - cam.x + Math.cos(a) * s.r * prog, FLOOR + 0.05 - cam.y, s.z - cam.z + Math.sin(a) * s.r * prog), Mat.rotY(-a)), 0.12, 0.06, 0.8, [1, 0.5, 0.3], 0.8, 0.5);
        }
      }
      for (const f of this.fbs) {
        const M = T(f.x - cam.x, f.y - cam.y, f.z - cam.z);
        gfx.drawBox(M, 0.42, 0.42, 0.42, [1, 0.55, 0.15], 1);
        gfx.drawBox(M, 0.7, 0.7, 0.7, [1, 0.3, 0.1], 0.8, 0.3);
      }
      const b = this.b; if (!b) return;
      const flash = b.hitT > 0, M = mul(T(b.x - cam.x, b.y - cam.y, b.z - cam.z), Mat.rotY(b.yaw));
      gfx.drawBox(M, 0.95, 0.95, 0.95, flash ? [1, 1, 1] : [0.45, 1, 1], 1);
      gfx.drawBox(M, 1.6, 1.6, 1.6, flash ? [1, 0.9, 0.9] : [0.55, 0.28, 0.95], 0.45, 0.62);
      for (let i = 0; i < 4; i++) {
        const a = time * 1.6 + i * Math.PI / 2;
        gfx.drawBox(mul(M, mul(T(Math.cos(a) * 2.1, Math.sin(time * 2 + i) * 0.5, Math.sin(a) * 2.1), Mat.rotY(-a))), 0.36, 1.1, 0.36, [0.7, 0.45, 1], 0.7);
      }
      for (const s of [-1, 1]) gfx.drawBox(mul(M, T(s * 0.4, 0.25, -0.82)), 0.22, 0.14, 0.06, [1, 0.15, 0.15], 1);
      if (b.ph >= 2) for (let i = 0; i < 3; i++) gfx.drawBox(mul(M, T((i - 1) * 0.55, 1.05, 0)), 0.2, 0.6 + (i === 1 ? 0.3 : 0), 0.2, [0.8, 0.6, 1], 0.9);
    }
  };

  G.Boss = Boss;
})(window.LUMINA = window.LUMINA || {});
