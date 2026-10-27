/* ===========================================================
 * player.js — 플레이어 물리 / 체력 / 낙사 데미지 / 윙 글라이드
 *  - 낙하 거리 3블록 초과분 × 1 = 데미지(체력 20 = 하트 10칸)
 *  - 독창 요소 "윙 글라이드": 공중에서 점프를 한 번 더 눌러 유지하면 활공.
 *    에너지(윙 게이지)를 소모하며, 활공 중에는 낙하 거리가 누적되지 않는다.
 * =========================================================== */
(function (G) {
  'use strict';
  const { B, SOLID } = G.Blocks;
  const W = 0.3, HGT = 1.8, EYE = 1.62;

  class Player {
    constructor(world) {
      this.world = world;
      this.maxHp = 20; this.maxEnergy = 100;
      this.yaw = 0; this.pitch = 0;
      this.onDamage = null; this.onDeath = null; this.onLand = null; this.onJump = null; this.onGlide = null; this.onSplash = null;
      this.respawn({ x: 8.5, y: 80, z: 8.5 });
    }

    respawn(p) {
      this.x = p.x; this.y = p.y; this.z = p.z;
      this.vx = this.vy = this.vz = 0;
      this.hp = this.maxHp; this.energy = this.maxEnergy; this.dead = false;
      this.onGround = false; this.inWater = false; this.headWater = false; this.wasInWater = false;
      this.gliding = false; this.glideAmt = 0; this.airTime = 0; this.fallPeak = this.y;
      this.sinceDmg = 99; this.regenT = 0; this.invuln = 3; this.walkPhase = 0; this.speedH = 0; this.hitWall = false;
    }

    get eyeY() { return this.y + EYE; }

    collides(x, y, z) {
      const w = this.world;
      const x0 = Math.floor(x - W), x1 = Math.floor(x + W - 1e-7);
      const y0 = Math.floor(y), y1 = Math.floor(y + HGT - 1e-7);
      const z0 = Math.floor(z - W), z1 = Math.floor(z + W - 1e-7);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) for (let iy = y0; iy <= y1; iy++) {
        if (SOLID[w.getBlock(ix, iy, iz)]) return true;
      }
      return false;
    }
    /** 주어진 칸이 플레이어와 겹치는가 (블록 설치 검사용) */
    overlapsBlock(bx, by, bz) {
      return bx + 1 > this.x - W && bx < this.x + W && by + 1 > this.y && by < this.y + HGT && bz + 1 > this.z - W && bz < this.z + W;
    }

    _move(axis, d) {
      if (d === 0) return false;
      const steps = Math.ceil(Math.abs(d) / 0.25), sd = d / steps;
      for (let i = 0; i < steps; i++) {
        if (axis === 0) {
          this.x += sd;
          if (this.collides(this.x, this.y, this.z)) {
            this.x = sd > 0 ? Math.floor(this.x + W) - W - 1e-4 : Math.floor(this.x - W) + 1 + W + 1e-4;
            this.vx = 0; return true;
          }
        } else if (axis === 2) {
          this.z += sd;
          if (this.collides(this.x, this.y, this.z)) {
            this.z = sd > 0 ? Math.floor(this.z + W) - W - 1e-4 : Math.floor(this.z - W) + 1 + W + 1e-4;
            this.vz = 0; return true;
          }
        } else {
          this.y += sd;
          if (this.collides(this.x, this.y, this.z)) {
            this.y = sd > 0 ? Math.floor(this.y + HGT) - HGT - 1e-4 : Math.floor(this.y) + 1;
            this.vy = 0; return true;
          }
        }
      }
      return false;
    }

    damage(n) {
      if (this.dead || n <= 0 || this.invuln > 0) return;
      this.hp = Math.max(0, this.hp - n); this.sinceDmg = 0;
      if (this.onDamage) this.onDamage(n);
      if (this.hp <= 0) { this.dead = true; this.gliding = false; if (this.onDeath) this.onDeath(); }
    }

    update(dt, inp) {
      if (this.dead) return;
      if (this.invuln > 0) this.invuln -= dt;
      const w = this.world;
      if (this.y < -20) { this.invuln = 0; this.damage(999); return; }
      const bx = Math.floor(this.x), bz = Math.floor(this.z);
      const feet = w.getBlock(bx, Math.floor(this.y + 0.1), bz), mid = w.getBlock(bx, Math.floor(this.y + 0.9), bz);
      const head = w.getBlock(bx, Math.floor(this.y + EYE), bz);
      this.inWater = feet === B.WATER || mid === B.WATER;
      this.headWater = head === B.WATER;
      if (this.inWater && !this.wasInWater && this.vy < -4 && this.onSplash) this.onSplash(-this.vy);
      this.wasInWater = this.inWater;

      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      let mx = inp.mx, mz = inp.mz;
      const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
      const wx = -sy * mz + cy * mx, wz = -cy * mz - sy * mx;

      /* --- 점프 / 글라이드 시작 --- */
      if (inp.jumpPressed) {
        if (this.onGround && !this.inWater) { this.vy = 9.2; this.onGround = false; if (this.onJump) this.onJump(); }
        else if (!this.onGround && !this.inWater && !this.gliding && this.airTime > 0.12 && this.energy > 8) {
          this.gliding = true; if (this.onGlide) this.onGlide(true);
        }
      }
      if (this.gliding && (!inp.jumpHeld || this.onGround || this.inWater || this.energy <= 0)) {
        this.gliding = false; if (this.onGlide) this.onGlide(false);
        this.fallPeak = this.y;
      }

      if (this.gliding) {
        const p = this.pitch, down = Math.min(Math.max(0, -p), 1.2), up = Math.min(Math.max(0, p), 0.8);
        const spd = 8 + down * 5 - up * 3, tvy = -2.0 - down * 6.5 + up * 3.4;
        const hx = -sy, hz = -cy, k = 1 - Math.exp(-dt * 2.4);
        this.vx += (hx * spd - this.vx) * k; this.vz += (hz * spd - this.vz) * k;
        this.vy += (tvy - this.vy) * (1 - Math.exp(-dt * 3.2));
        this.energy = Math.max(0, this.energy - dt * (9 + up * 16));
        this.fallPeak = this.y;
      } else {
        let speed = (inp.sprint && mz > 0.1 && !this.inWater) ? 6.1 : 4.3;
        if (this.inWater) speed *= 0.55;
        const acc = this.onGround ? 16 : (this.inWater ? 6 : 3.6), k = 1 - Math.exp(-acc * dt);
        this.vx += (wx * speed - this.vx) * k; this.vz += (wz * speed - this.vz) * k;
        if (this.inWater) {
          this.vy -= 9 * dt; this.vy *= Math.exp(-dt * 2.4);
          if (inp.jumpHeld) { this.vy = Math.min(3.6, this.vy + 24 * dt); if (!this.headWater && this.hitWall) this.vy = 6.4; }
          if (this.vy < -3.2) this.vy = -3.2;
          this.fallPeak = this.y;
        } else {
          this.vy = Math.max(-55, this.vy - 30 * dt);
        }
      }

      /* --- 이동 / 충돌 --- */
      const wasGround = this.onGround;
      const hitX = this._move(0, this.vx * dt), hitZ = this._move(2, this.vz * dt);
      this.hitWall = hitX || hitZ;
      const vyBefore = this.vy;
      const hitY = this._move(1, this.vy * dt);
      this.onGround = hitY && vyBefore < 0;
      if (this.onGround) {
        if (!wasGround) {
          const dist = this.fallPeak - this.y;
          let dmg = 0;
          if (!this.inWater && dist > 3) { dmg = Math.ceil(dist - 3); }
          if (this.onLand) this.onLand(dist, dmg);
          if (dmg > 0) this.damage(dmg);
        }
        this.fallPeak = this.y; this.airTime = 0;
      } else {
        this.airTime += dt;
        if (this.y > this.fallPeak) this.fallPeak = this.y;
      }

      /* --- 에너지 / 회복 / 애니메이션 값 --- */
      if (!this.gliding) this.energy = Math.min(this.maxEnergy, this.energy + dt * (this.onGround || this.inWater ? 38 : 5));
      this.sinceDmg += dt;
      if (this.sinceDmg > 6 && this.hp < this.maxHp && !this.dead) { this.regenT += dt; if (this.regenT >= 1.6) { this.hp++; this.regenT = 0; } }
      this.speedH = Math.hypot(this.vx, this.vz);
      if (this.onGround) this.walkPhase += this.speedH * dt * 1.7;
      this.glideAmt += ((this.gliding ? 1 : 0) - this.glideAmt) * Math.min(1, dt * 7);
    }
  }

  G.Player = Player;
  G.PLAYER_DIM = { W, HGT, EYE };
})(window.LUMINA = window.LUMINA || {});
