/* ===========================================================
 * controls.js — PC(키보드·마우스) / 모바일(가상 조이스틱·터치) 입력
 *  두 방식 모두 같은 input 객체로 합쳐지고, 게임은 mode만 바꿔 쓴다.
 * =========================================================== */
(function (G) {
  'use strict';

  class Controls {
    constructor(canvas, hooks) {
      this.canvas = canvas; this.hooks = hooks || {};
      this.mode = 'pc'; this.enabled = false; this.locked = false; this.dragLook = false;
      this.sens = 1;
      this.keys = {};
      this.sprintLatch = false;
      this.in = this._blank();
      this._bindPC(); this._bindMobile();
    }
    _blank() {
      return { mx: 0, mz: 0, jumpHeld: false, jumpPressed: false, sprint: false, breakHeld: false, placePressed: false, placeHeld: false, pickPressed: false,
        dyaw: 0, dpitch: 0, hotbarDelta: 0, hotbarSet: -1 };
    }
    setMode(m) {
      this.mode = m;
      document.body.classList.toggle('mobile', m === 'mobile');
      document.body.classList.toggle('pc', m === 'pc');
      this.keys = {}; this.in.breakHeld = false; this.in.placeHeld = false; this.in.jumpHeld = false; this.in.mx = this.in.mz = 0;
      if (m === 'mobile' && document.pointerLockElement) document.exitPointerLock();
    }
    setEnabled(v) {
      this.enabled = v;
      if (!v) { this.keys = {}; this.in.breakHeld = false; this.in.placeHeld = false; this.in.jumpHeld = false; this.in.mx = this.in.mz = 0; }
    }
    lock() {
      if (this.mode !== 'pc') return;
      try {
        const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => { this.dragLook = true; });
      } catch (e) { this.dragLook = true; }
    }
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

    /** 프레임마다 호출: 누적된 입력을 꺼내고 1회성 값 초기화 */
    poll() {
      const k = this.keys, i = this.in;
      if (this.mode === 'pc') {
        i.mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
        i.mz = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
        i.sprint = !!(k.ShiftLeft || k.ShiftRight || k.ControlLeft);
        i.jumpHeld = !!k.Space;
      } else {
        i.sprint = this.sprintLatch;
      }
      const out = Object.assign({}, i);
      i.jumpPressed = false; i.placePressed = false; i.pickPressed = false;
      i.dyaw = 0; i.dpitch = 0; i.hotbarDelta = 0; i.hotbarSet = -1;
      return out;
    }

    /* ---------------- PC ---------------- */
    _bindPC() {
      const cv = this.canvas, h = this.hooks, self = this;
      document.addEventListener('pointerlockchange', () => {
        self.locked = document.pointerLockElement === cv;
        if (self.locked) self.dragLook = false;
        if (h.onLockChange) h.onLockChange(self.locked);
      });
      document.addEventListener('pointerlockerror', () => { self.dragLook = true; });
      window.addEventListener('keydown', e => {
        if (!self.enabled || self.mode !== 'pc') return;
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
        if (e.repeat) return;
        self.keys[e.code] = true;
        if (e.code === 'Space') self.in.jumpPressed = true;
        if (/^Digit[1-9]$/.test(e.code)) self.in.hotbarSet = +e.code.slice(5) - 1;
        if (e.code === 'KeyV' && h.onView) h.onView();
        if (e.code === 'KeyE' && h.onInventory) h.onInventory();
        if (e.code === 'F3') { e.preventDefault(); if (h.onDebug) h.onDebug(); }
        if (e.code === 'KeyP' && h.onMenu) h.onMenu();
        if ((e.code === 'Enter' || e.code === 'KeyT') && h.onChat) { e.preventDefault(); h.onChat(); }
      });
      window.addEventListener('keyup', e => { self.keys[e.code] = false; });
      window.addEventListener('blur', () => { self.keys = {}; self.in.breakHeld = false; });
      cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('mousedown', e => {
        if (!self.enabled || self.mode !== 'pc') return;
        if (!self.locked) { self.lock(); if (!self.dragLook) return; }
        if (e.button === 0) self.in.breakHeld = true;
        else if (e.button === 2) { self.in.placePressed = true; self.in.placeHeld = true; }
        else if (e.button === 1) { e.preventDefault(); self.in.pickPressed = true; }
      });
      window.addEventListener('mouseup', e => { if (e.button === 0) self.in.breakHeld = false; if (e.button === 2) self.in.placeHeld = false; });
      window.addEventListener('mousemove', e => {
        if (!self.enabled || self.mode !== 'pc') return;
        if (self.locked || (self.dragLook && e.buttons & 1)) {
          self.in.dyaw -= e.movementX * 0.0022 * self.sens;
          self.in.dpitch -= e.movementY * 0.0022 * self.sens;
        }
      });
      window.addEventListener('wheel', e => {
        if (!self.enabled || self.mode !== 'pc') return;
        self.in.hotbarDelta += Math.sign(e.deltaY);
      }, { passive: true });
    }

    /* ---------------- 모바일 ---------------- */
    _bindMobile() {
      const self = this, h = this.hooks;
      const $ = id => document.getElementById(id);
      const joyZone = $('joyZone'), lookZone = $('lookZone'), base = $('joyBase'), knob = $('joyKnob');
      if (!joyZone) return;
      const R = 58;
      let joyId = null, jox = 0, joy0 = 0, lookId = null, llx = 0, lly = 0;
      const find = (list, id) => { for (const t of list) if (t.identifier === id) return t; return null; };

      joyZone.addEventListener('touchstart', e => {
        if (!self.enabled || self.mode !== 'mobile') return;
        e.preventDefault();
        if (joyId !== null) return;
        const t = e.changedTouches[0]; joyId = t.identifier; jox = t.clientX; joy0 = t.clientY;
        base.style.display = 'block'; base.style.left = jox + 'px'; base.style.top = joy0 + 'px';
        knob.style.transform = 'translate(-50%,-50%)';
      }, { passive: false });
      joyZone.addEventListener('touchmove', e => {
        if (joyId === null) return; e.preventDefault();
        const t = find(e.changedTouches, joyId); if (!t) return;
        let dx = t.clientX - jox, dy = t.clientY - joy0; const l = Math.hypot(dx, dy);
        if (l > R) { dx = dx / l * R; dy = dy / l * R; }
        knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        self.in.mx = dx / R; self.in.mz = -dy / R;
      }, { passive: false });
      const joyEnd = e => {
        if (joyId === null || !find(e.changedTouches, joyId)) return;
        joyId = null; self.in.mx = self.in.mz = 0; base.style.display = 'none';
      };
      joyZone.addEventListener('touchend', joyEnd); joyZone.addEventListener('touchcancel', joyEnd);

      lookZone.addEventListener('touchstart', e => {
        if (!self.enabled || self.mode !== 'mobile') return;
        e.preventDefault();
        if (lookId !== null) return;
        const t = e.changedTouches[0]; lookId = t.identifier; llx = t.clientX; lly = t.clientY;
      }, { passive: false });
      lookZone.addEventListener('touchmove', e => {
        if (lookId === null) return; e.preventDefault();
        const t = find(e.changedTouches, lookId); if (!t) return;
        self.in.dyaw -= (t.clientX - llx) * 0.0052 * self.sens;
        self.in.dpitch -= (t.clientY - lly) * 0.0052 * self.sens;
        llx = t.clientX; lly = t.clientY;
      }, { passive: false });
      const lookEnd = e => { if (lookId !== null && find(e.changedTouches, lookId)) lookId = null; };
      lookZone.addEventListener('touchend', lookEnd); lookZone.addEventListener('touchcancel', lookEnd);

      // 버튼
      const press = (el, down, up) => {
        if (!el) return;
        el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); if (self.enabled) down(); el.classList.add('on'); }, { passive: false });
        const end = e => { e.preventDefault(); if (up) up(); el.classList.remove('on'); };
        el.addEventListener('touchend', end, { passive: false }); el.addEventListener('touchcancel', end, { passive: false });
      };
      press($('btnJump'), () => { self.in.jumpHeld = true; self.in.jumpPressed = true; }, () => { self.in.jumpHeld = false; });
      press($('btnBreak'), () => { self.in.breakHeld = true; }, () => { self.in.breakHeld = false; });
      press($('btnPlace'), () => { self.in.placePressed = true; self.in.placeHeld = true; }, () => { self.in.placeHeld = false; });
      press($('btnNext'), () => { self.in.hotbarDelta += 1; });
      press($('btnView'), () => { if (h.onView) h.onView(); });
      press($('btnInv'), () => { if (h.onInventory) h.onInventory(); });
      press($('btnSprint'), () => { self.sprintLatch = !self.sprintLatch; $('btnSprint').classList.toggle('latched', self.sprintLatch); });
    }
  }

  G.Controls = Controls;
})(window.LUMINA = window.LUMINA || {});
