/* ===========================================================
 * ui.js — 설정 저장, HUD(하트/윙 게이지/핫바), 설정창, 캐릭터 편집, 블록 선택창
 * =========================================================== */
(function (G) {
  'use strict';
  const { Blocks, Character, Mat, Gfx } = G;
  const $ = id => document.getElementById(id);

  /* ---------- 설정 ---------- */
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const DEFAULTS = {
    device: null, renderDistance: isTouch ? 4 : 7, fov: 72, sens: 1, view: 0, resScale: isTouch ? 75 : 100, volume: 60,
    dayCycle: 1, debug: false, seed: '', app: Object.assign({}, Character.DEFAULT_APP), hotbar: Blocks.DEFAULT_HOTBAR.slice()
  };
  const KEY = 'lumina.settings.v1';
  const Settings = {
    data: JSON.parse(JSON.stringify(DEFAULTS)),
    load() {
      try {
        const s = JSON.parse(localStorage.getItem(KEY) || 'null');
        if (s) { Object.assign(this.data, s); this.data.app = Object.assign({}, Character.DEFAULT_APP, s.app || {}); if (!Array.isArray(this.data.hotbar) || this.data.hotbar.length !== 9) this.data.hotbar = Blocks.DEFAULT_HOTBAR.slice(); }
      } catch (e) { /* 저장소 사용 불가 */ }
      return this.data;
    },
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ } }
  };

  const UI = { cb: {}, settings: Settings.data };

  /* ---------- HUD ---------- */
  let hearts = [], lastHp = -1;
  function buildHearts() {
    const box = $('hearts'); box.innerHTML = ''; hearts = [];
    for (let i = 0; i < 10; i++) { const h = document.createElement('div'); h.className = 'heart'; h.appendChild(document.createElement('i')); box.appendChild(h); hearts.push(h); }
  }
  UI.setHearts = function (hp) {
    if (hp === lastHp) return;
    const dmg = lastHp > hp && lastHp >= 0;
    hearts.forEach((h, i) => {
      const v = Math.max(0, Math.min(2, hp - i * 2));
      h.firstChild.style.setProperty('--p', (v / 2 * 100) + '%');
      h.classList.toggle('low', hp <= 6 && hp > 0 && v > 0);
      if (dmg && v < 2) { h.classList.remove('hit'); void h.offsetWidth; h.classList.add('hit'); }
    });
    lastHp = hp;
  };
  UI.setWing = function (e, max) { $('wingBar').firstElementChild.style.transform = 'scaleX(' + Math.max(0, Math.min(1, e / max)) + ')'; };
  let toastT = 0;
  UI.toast = function (msg, ms) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms || 1800);
  };
  UI.flashHurt = function () { const f = $('hurtFlash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); };
  UI.setUnderwater = b => $('underwater').classList.toggle('on', !!b);
  UI.setDebug = function (txt) { const d = $('debug'); if (txt === null) d.classList.add('hidden'); else { d.classList.remove('hidden'); d.textContent = txt; } };
  UI.setClock = function (tod) {
    const hr = ((tod * 24 + 6) % 24 + 24) % 24, h = Math.floor(hr), m = Math.floor((hr - h) * 60);
    $('timeChip').textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + (hr >= 6 && hr < 18 ? ' ☀' : ' ☾');
  };

  /* 핫바 */
  let slotEls = [];
  UI.buildHotbar = function (hotbar, sel) {
    const bar = $('hotbar'); bar.innerHTML = ''; slotEls = [];
    hotbar.forEach((id, i) => {
      const s = document.createElement('button'); s.className = 'slot'; s.type = 'button';
      const c = Blocks.makeIcon(id, 64).cloneNode(true);
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; cv.getContext('2d').drawImage(Blocks.makeIcon(id, 64), 0, 0);
      s.appendChild(cv);
      const n = document.createElement('em'); n.textContent = i + 1; s.appendChild(n);
      s.addEventListener('click', () => UI.cb.onSelectSlot && UI.cb.onSelectSlot(i));
      s.addEventListener('touchstart', e => { e.stopPropagation(); }, { passive: true });
      bar.appendChild(s); slotEls.push(s);
    });
    UI.selectSlot(sel);
  };
  UI.selectSlot = function (i) { slotEls.forEach((s, k) => s.classList.toggle('sel', k === i)); };

  /* 블록 선택창 */
  UI.buildInventory = function () {
    const g = $('invGrid'); g.innerHTML = '';
    Blocks.PLACEABLE.forEach(id => {
      const b = document.createElement('button'); b.className = 'inv-item'; b.type = 'button';
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; cv.getContext('2d').drawImage(Blocks.makeIcon(id, 64), 0, 0);
      b.appendChild(cv); const t = document.createElement('span'); t.textContent = Blocks.INFO[id].name; b.appendChild(t);
      b.addEventListener('click', () => { Sfx_click(); UI.cb.onPickBlock && UI.cb.onPickBlock(id); });
      g.appendChild(b);
    });
  };
  const Sfx_click = () => G.Sfx && G.Sfx.play('click');
  UI.showInventory = b => $('inventory').classList.toggle('hidden', !b);
  UI.showMenu = function (b) { $('menu').classList.toggle('hidden', !b); if (b) { syncMenu(); } else stopPreview(); };
  UI.showDeath = function (b, msg) { $('death').classList.toggle('hidden', !b); if (msg) $('deathMsg').textContent = msg; };

  /* ---------- 시작 화면 ---------- */
  UI.initStart = function () {
    const S = Settings.data;
    const tips = {
      pc: ['WASD 이동 · Space 점프 · <b>공중에서 Space 한 번 더(유지) = 활공</b>', '좌클릭 부수기 · 우클릭 놓기 · V 시점 전환 · E 블록 선택', 'Esc 로 설정(캐릭터 디자인 · 청크 거리)을 열 수 있어요'],
      mobile: ['왼쪽 화면 드래그 = 이동 · 오른쪽 화면 드래그 = 시점', '<b>공중에서 점프 버튼을 다시 눌러 유지 = 활공</b>', '가로 화면에서 플레이하면 더 편해요']
    };
    const setDev = d => {
      S.device = d;
      document.querySelectorAll('#start .device').forEach(b => b.classList.toggle('sel', b.dataset.dev === d));
      $('tips').innerHTML = tips[d].map(t => '<li>' + t + '</li>').join('');
      UI.cb.onDevice && UI.cb.onDevice(d);
    };
    document.querySelectorAll('#start .device').forEach(b => b.addEventListener('click', () => setDev(b.dataset.dev)));
    setDev(S.device || (isTouch ? 'mobile' : 'pc'));
    const rd = $('stRd'), out = $('stRdOut');
    rd.value = S.renderDistance;
    const upd = () => { out.textContent = rd.value + ' 청크 (' + rd.value * 16 + '블록)'; };
    rd.addEventListener('input', () => { S.renderDistance = +rd.value; upd(); });
    upd();
    $('stSeed').value = S.seed || '';
  };

  /* ---------- 설정창 ---------- */
  function seg(id, getVal, onSet) {
    const el = $(id);
    el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { onSet(b.dataset.v); mark(); Sfx_click(); }));
    const mark = () => el.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(getVal()) === b.dataset.v));
    return mark;
  }
  function range(id, outId, get, set, fmt) {
    const el = $(id), out = $(outId);
    el.addEventListener('input', () => { set(+el.value); out.textContent = fmt(+el.value); });
    return () => { el.value = get(); out.textContent = fmt(+el.value); };
  }
  let syncers = [], pv = null, pvRaf = 0, pvYaw = 0.5, pvPose = 0, pvDrag = null;

  function initMenu() {
    const S = Settings.data;
    const commit = () => Settings.save();
    syncers.push(seg('opDevice', () => S.device, v => { S.device = v; commit(); UI.cb.onDevice && UI.cb.onDevice(v); }));
    syncers.push(range('opRd', 'opRdOut', () => S.renderDistance, v => { S.renderDistance = v; commit(); UI.cb.onRenderDistance && UI.cb.onRenderDistance(v); }, v => v + ' 청크 (' + v * 16 + 'm)'));
    syncers.push(seg('opView', () => S.view, v => { S.view = +v; commit(); }));
    syncers.push(range('opFov', 'opFovOut', () => S.fov, v => { S.fov = v; commit(); }, v => v + '°'));
    syncers.push(range('opSens', 'opSensOut', () => S.sens, v => { S.sens = v; commit(); UI.cb.onSens && UI.cb.onSens(v); }, v => v.toFixed(2) + '×'));
    syncers.push(range('opRes', 'opResOut', () => S.resScale, v => { S.resScale = v; commit(); UI.cb.onResize && UI.cb.onResize(); }, v => v + '%'));
    syncers.push(range('opVol', 'opVolOut', () => S.volume, v => { S.volume = v; commit(); G.Sfx.setVolume(v / 100); }, v => v + '%'));
    syncers.push(seg('opDay', () => S.dayCycle, v => { S.dayCycle = +v; commit(); }));
    $('opTime').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { UI.cb.onSetTime && UI.cb.onSetTime(+b.dataset.v); }));
    $('opDebug').addEventListener('change', e => { S.debug = e.target.checked; commit(); UI.cb.onDebug && UI.cb.onDebug(); });
    syncers.push(() => { $('opDebug').checked = !!S.debug; });

    // 탭
    document.querySelectorAll('#menu .tabs button').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('#menu .tabs button').forEach(x => x.classList.toggle('active', x === b));
      ['game', 'char', 'world'].forEach(t => $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab));
      if (b.dataset.tab === 'char') startPreview(); else stopPreview();
    }));

    // 월드
    $('btnNewWorld').addEventListener('click', () => { S.seed = $('opSeed').value; commit(); UI.cb.onNewWorld && UI.cb.onNewWorld(S.seed); });
    $('btnRandomWorld').addEventListener('click', () => { S.seed = ''; $('opSeed').value = ''; commit(); UI.cb.onNewWorld && UI.cb.onNewWorld(''); });
    $('btnToSpawn').addEventListener('click', () => UI.cb.onToSpawn && UI.cb.onToSpawn());
    $('btnResume').addEventListener('click', () => UI.cb.onResume && UI.cb.onResume());
    $('btnInvClose').addEventListener('click', () => UI.cb.onInventory && UI.cb.onInventory());
    $('btnRespawn').addEventListener('click', () => UI.cb.onRespawn && UI.cb.onRespawn());
    $('btnMenu').addEventListener('click', () => UI.cb.onMenu && UI.cb.onMenu());
    $('btnViewTop').addEventListener('click', () => UI.cb.onView && UI.cb.onView());
    $('inventory').addEventListener('mousedown', e => { if (e.target === $('inventory')) UI.cb.onInventory && UI.cb.onInventory(); });

    buildCharOptions();
    // 미리보기 포즈 / 드래그
    $('pvPose').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { pvPose = +b.dataset.v; markPose(); }));
    const markPose = () => $('pvPose').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.v === pvPose));
    syncers.push(markPose);
    const cv = $('charPreview');
    cv.addEventListener('pointerdown', e => { pvDrag = { x: e.clientX, yaw: pvYaw }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; });
    cv.addEventListener('pointermove', e => { if (pvDrag) pvYaw = pvDrag.yaw + (e.clientX - pvDrag.x) * 0.012; });
    cv.addEventListener('pointerup', () => { pvDrag = null; cv.style.cursor = 'grab'; });
  }
  function syncMenu() {
    syncers.forEach(f => f());
    $('opSeed').value = Settings.data.seed || '';
    document.querySelectorAll('#menu .tab').forEach(t => t.classList.toggle('hidden', t.id !== 'tab-game'));
    document.querySelectorAll('#menu .tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'game'));
  }

  /* ---------- 캐릭터 편집 ---------- */
  const LABELS = { skin: '피부', hair: '머리색', shirt: '상의', pants: '하의', shoes: '신발', eyes: '눈', wings: '윙(날개) 색' };
  function buildCharOptions() {
    const box = $('charOpts'), app = Settings.data.app; box.innerHTML = '';
    const changed = () => { Settings.save(); UI.cb.onAppearance && UI.cb.onAppearance(); };
    const refreshers = [];
    Object.keys(LABELS).forEach(key => {
      const d = document.createElement('div'); d.className = 'opt';
      d.innerHTML = '<span>' + LABELS[key] + '</span>';
      const sw = document.createElement('div'); sw.className = 'sw'; d.appendChild(sw);
      const btns = Character.SWATCH[key].map(c => {
        const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.title = c;
        b.addEventListener('click', () => { app[key] = c; inp.value = c; mark(); changed(); }); sw.appendChild(b); return [b, c];
      });
      const inp = document.createElement('input'); inp.type = 'color'; inp.title = '직접 고르기';
      inp.addEventListener('input', () => { app[key] = inp.value; mark(); changed(); });
      sw.appendChild(inp);
      const mark = () => { btns.forEach(([b, c]) => b.classList.toggle('on', c.toLowerCase() === app[key].toLowerCase())); inp.value = app[key]; };
      mark(); refreshers.push(mark); box.appendChild(d);
    });
    const choice = (label, list, key) => {
      const d = document.createElement('div'); d.className = 'opt'; d.innerHTML = '<span>' + label + '</span>';
      const s = document.createElement('div'); s.className = 'seg small';
      list.forEach((n, i) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = n; b.addEventListener('click', () => { app[key] = i; mark(); changed(); }); s.appendChild(b); });
      const mark = () => s.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', app[key] === i));
      mark(); refreshers.push(mark); d.appendChild(s); box.appendChild(d);
    };
    choice('머리 모양', Character.HAIR_STYLES, 'hairStyle');
    choice('액세서리', Character.ACCESSORIES, 'accessory');
    const act = document.createElement('div'); act.className = 'opt-actions';
    const rnd = document.createElement('button'); rnd.className = 'ghost'; rnd.type = 'button'; rnd.textContent = '랜덤 디자인';
    rnd.addEventListener('click', () => {
      const pick = a => a[Math.floor(Math.random() * a.length)];
      Object.keys(LABELS).forEach(k => { app[k] = pick(Character.SWATCH[k]); });
      app.hairStyle = Math.floor(Math.random() * 4); app.accessory = Math.floor(Math.random() * 4);
      refreshers.forEach(f => f()); changed();
    });
    const rst = document.createElement('button'); rst.className = 'ghost'; rst.type = 'button'; rst.textContent = '기본값';
    rst.addEventListener('click', () => { Object.assign(app, Character.DEFAULT_APP); refreshers.forEach(f => f()); changed(); });
    act.appendChild(rnd); act.appendChild(rst); box.appendChild(act);
    syncers.push(() => refreshers.forEach(f => f()));
  }

  /* 미리보기 렌더 */
  function startPreview() {
    if (!pv) {
      try { pv = new Gfx($('charPreview'), { antialias: true }); } catch (e) { return; }
    }
    cancelAnimationFrame(pvRaf);
    let t0 = performance.now(), phase = 0;
    const env = { sunLight: [0.35, 0.8, 0.5], entLight: [1, 1, 1], fogCol: [0.07, 0.1, 0.2], fogNear: 1e5, fogFar: 2e5 };
    const loop = now => {
      pvRaf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - t0) / 1000); t0 = now; phase += dt;
      if (!pvDrag) pvYaw += dt * 0.35;
      const gfx = pv, app = Settings.data.app;
      gfx.begin(0.07, 0.1, 0.2);
      const P = Mat.persp(0.62, gfx.aspect, 0.1, 50);
      gfx.beginEntities(P, env, false);
      const st = { walk: phase * 6, swing: pvPose === 1 ? 0.75 : 0, glide: pvPose === 2 ? 1 : 0, attack: 0, headYaw: 0, headPitch: 0 };
      const M0 = Mat.mul(Mat.trans(0, -0.98 + (pvPose === 2 ? 0.05 * Math.sin(phase * 2) : 0), -3.7), Mat.rotY(pvYaw));
      Character.drawBody(gfx, app, M0, st);
    };
    pvRaf = requestAnimationFrame(loop);
  }
  function stopPreview() { cancelAnimationFrame(pvRaf); }

  UI.init = function () {
    buildHearts(); initMenu(); UI.buildInventory();
    window.addEventListener('beforeunload', () => Settings.save());
  };
  UI.refreshCharacterOptions = buildCharOptions;

  G.Settings = Settings; G.UI = UI;
})(window.LUMINA = window.LUMINA || {});
