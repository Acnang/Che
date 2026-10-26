/* ===========================================================
 * main.js — 게임 루프: 환경(낮/밤), 카메라(1·3인칭), 상호작용, 렌더 순서
 * =========================================================== */
(function (G) {
  'use strict';
  const { Mat, Blocks, World, Player, Character, Controls, UI, Settings, Sfx, seedFrom, Net } = G;
  const { B, SOLID, PLANT, TARGET } = Blocks;
  const $ = id => document.getElementById(id);
  const S = Settings.data;

  let gfx, world, player, controls;
  const st = {
    phase: 'start', paused: true, menuOpen: false, invOpen: false, sel: 0, tod: 0.14, time: 0, target: null,
    breakT: 0, attackT: 0, bodyYaw: 0, particles: [], shake: 0, spawn: null, fps: 60, dbgT: 0, hintShown: false, loadStart: 0, deathCause: '', netT: 0, tags: new Map()
  };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  /* ---------- 부팅 ---------- */
  function boot() {
    Settings.load();
    const atlas = Blocks.init();
    try {
      gfx = new G.Gfx($('game'), { antialias: true });
    } catch (e) {
      $('glError').textContent = '3D 그래픽(WebGL)을 사용할 수 없어요: ' + e.message; $('glError').classList.remove('hidden');
      $('btnStart').disabled = true; return;
    }
    gfx.setAtlas(atlas); gfx.setCloudTex(Blocks.buildCloud());
    controls = new Controls($('game'), {
      onLockChange: locked => { if (!locked && st.phase === 'play' && !st.menuOpen && !st.invOpen && !st.dead && controls.mode === 'pc') openMenu(); },
      onView: cycleView, onInventory: toggleInventory, onDebug: toggleDebug, onMenu: () => (st.menuOpen ? closeMenu() : openMenu())
    });
    controls.sens = S.sens;
    UI.init(); UI.initStart();
    if (!S.name) { S.name = '플레이어' + (100 + Math.floor(Math.random() * 900)); Settings.save(); }
    $('stName').value = S.name;
    Sfx.setVolume(S.volume / 100);
    UI.cb = {
      onDevice: d => { S.device = d; Settings.save(); controls.setMode(d); $('mobileUI').classList.toggle('active', st.phase === 'play' && d === 'mobile'); },
      onRenderDistance: r => { if (world) world.setRenderDistance(r); },
      onSens: v => { controls.sens = v; }, onResize: resize,
      onSetTime: t => { st.tod = t; UI.toast('시간 이동'); },
      onDebug: toggleDebug0, onNewWorld: seed => newWorld(seed), onToSpawn: () => { teleportSpawn(); closeMenu(); },
      onResume: closeMenu, onInventory: toggleInventory, onMenu: () => openMenu(), onView: cycleView,
      onAppearance: () => { if (Net.active) Net.sendApp(S.app); }, onSelectSlot: selectSlot, onPickBlock: id => { S.hotbar[st.sel] = id; Settings.save(); UI.buildHotbar(S.hotbar, st.sel); toggleInventory(); },
      onRespawn: respawn
    };
    controls.setMode(S.device || 'pc');
    $('btnStart').addEventListener('click', () => startGame());
    setupMultiplayer();
    window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 200));
    resize();
    requestAnimationFrame(frame);
    window.LUMINA_DEBUG = { get world() { return world; }, get player() { return player; }, st, gfx };
  }

  function resize() {
    const cv = $('game'), dpr = Math.min(window.devicePixelRatio || 1, 2), sc = (S.resScale || 100) / 100;
    gfx.resize(Math.round(window.innerWidth * dpr * sc), Math.round(window.innerHeight * dpr * sc));
  }

  /* ---------- 게임 시작/월드 ---------- */
  function startGame() {
    Sfx.unlock();
    S.seed = $('stSeed').value; S.renderDistance = +$('stRd').value; Settings.save();
    controls.setMode(S.device || 'pc');
    try { if (S.device === 'mobile' && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) { /* ignore */ }
    $('start').classList.add('hidden');
    newWorld(S.seed, true);
    if (S.device === 'pc') controls.lock();
  }

  function newWorld(seedStr, first) {
    if (world) world.dispose();
    const seed = seedFrom(seedStr);
    world = new World(seed, gfx); world.setRenderDistance(S.renderDistance);
    world.onEdit = (x, y, z, b) => { if (Net.active) Net.sendBlock(x, y, z, b); };
    st.spawn = world.findSpawn();
    player = new Player(world); player.respawn(st.spawn);
    wirePlayer();
    st.phase = 'loading'; st.paused = true; st.loadStart = performance.now(); st.dead = false;
    st.menuOpen = false; st.invOpen = false; st.particles.length = 0;
    UI.showMenu(false); UI.showInventory(false); UI.showDeath(false);
    $('loading').classList.remove('hidden'); $('hud').classList.add('hidden'); $('mobileUI').classList.remove('active');
    controls.setEnabled(false);
    if (!first && S.device === 'pc') controls.lock();
    UI.buildHotbar(S.hotbar, st.sel); 
  }

  function wirePlayer() {
    player.onDamage = n => { UI.flashHurt(); Sfx.play('hurt'); st.shake = Math.min(0.5, 0.15 + n * 0.03); };
    player.onDeath = () => {
      st.dead = true; st.paused = true;
      $('deathTitle').textContent = '쓰러졌어요';
      UI.showDeath(true, st.deathCause === 'void' ? '하늘 끝없이 떨어졌어요. 날개를 펴는 걸 잊지 마세요!' : '높은 곳에서 떨어졌어요. 공중에서 점프를 한 번 더 눌러 활공해 보세요.');
      controls.setEnabled(false); controls.unlock();
    };
    player.onLand = (dist, dmg) => { if (dist > 1.6) Sfx.play('land', dist); };
    player.onGlide = on => { if (on) Sfx.play('glide'); };
    player.onSplash = v => Sfx.play('splash');
  }

  function respawn() {
    player.respawn(st.spawn || world.findSpawn()); st.dead = false; st.paused = false;
    UI.showDeath(false); controls.setEnabled(true); Sfx.play('respawn');
    if (S.device === 'pc') controls.lock();
  }
  function teleportSpawn() { const sp = st.spawn || world.findSpawn(); player.x = sp.x; player.y = sp.y + 0.5; player.z = sp.z; player.vx = player.vy = player.vz = 0; player.fallPeak = player.y; }

  /* ---------- 메뉴/상태 ---------- */
  function openMenu() {
    if (st.phase !== 'play' || st.dead) return;
    st.menuOpen = true; st.paused = true; st.invOpen = false; UI.showInventory(false); UI.showMenu(true);
    controls.setEnabled(false); controls.unlock();
  }
  function closeMenu() {
    st.menuOpen = false; st.paused = false; UI.showMenu(false); controls.setEnabled(true);
    if (S.device === 'pc') controls.lock();
  }
  function toggleInventory() {
    if (st.phase !== 'play' || st.dead || st.menuOpen) return;
    st.invOpen = !st.invOpen; UI.showInventory(st.invOpen);
    st.paused = st.invOpen; controls.setEnabled(!st.invOpen);
    if (st.invOpen) controls.unlock(); else if (S.device === 'pc') controls.lock();
  }
  function cycleView() { S.view = (S.view + 1) % 3; Settings.save(); UI.toast(['1인칭 시점', '3인칭 시점 (뒤)', '3인칭 시점 (앞)'][S.view]); }
  function toggleDebug() { S.debug = !S.debug; Settings.save(); toggleDebug0(); }
  function toggleDebug0() { if (!S.debug) UI.setDebug(null); }
  function selectSlot(i) { st.sel = clamp(i, 0, 8); UI.selectSlot(st.sel); UI.toast(Blocks.INFO[S.hotbar[st.sel]].name, 900); Sfx.play('click'); }

  /* ---------- 환경 (낮/밤) ---------- */
  const C = {
    zenN: [0.025, 0.04, 0.11], zenD: [0.27, 0.5, 0.9], horN: [0.05, 0.07, 0.16], horD: [0.7, 0.84, 0.96],
    litN: [0.2, 0.24, 0.42], litD: [1, 1, 1]
  };
  function makeEnv(vp, cam, underwater) {
    const a = st.tod * Math.PI * 2, s = Math.sin(a);
    const sunDir = norm3([Math.cos(a) * 0.9, s, 0.35]);
    const day = smooth(-0.12, 0.28, s), tw = Math.exp(-Math.pow(s / 0.2, 2));
    let zen = mix3(C.zenN, C.zenD, day), hor = mix3(C.horN, C.horD, day);
    zen = [zen[0] + tw * 0.08, zen[1] + tw * 0.03, zen[2]]; hor = [Math.min(1, hor[0] + tw * 0.42), Math.min(1, hor[1] + tw * 0.2), hor[2] + tw * 0.02];
    let light = mix3(C.litN, C.litD, day); light = [light[0] * (1 + tw * 0.08), light[1] * (1 - tw * 0.04), light[2] * (1 - tw * 0.14)];
    const R = world.R, fogFar = Math.max(40, R * 16 * 0.96);
    const env = {
      vp, planes: Mat.frustum(vp), light, night: 1 - day, fogCol: hor.slice(), fogNear: fogFar * 0.5, fogFar,
      zen, hor, sunDir, sunCol: [1, 0.62 + 0.3 * day, 0.28 + 0.4 * day], sunGlow: clamp(0.25 + tw * 1.1, 0, 1.2), sunDisc: [1, 0.92 + 0.05 * day, 0.72 + 0.2 * day],
      starAlpha: clamp((0.55 - day) / 0.55, 0, 1), time: st.time, pixelScale: Math.max(1, gfx.canvas.width / window.innerWidth),
      cloudCam: [((cam.x % 512) + 512) % 512 + st.time * 3, ((cam.z % 512) + 512) % 512], cloudY: 138 - cam.y, cloudR: Math.min(fogFar * 1.6 + 60, 520),
      cloudCol: mix3([0.3, 0.34, 0.52], [1, 1, 1], day), cloudAlpha: 0.88,
      entLight: [light[0] * 1.05, light[1] * 1.05, light[2] * 1.05], sunLight: day > 0.15 ? sunDir : norm3([-sunDir[0], -sunDir[1], -sunDir[2]])
    };
    env.cloudCol = [env.cloudCol[0] * (1 + tw * 0.1), env.cloudCol[1] * (1 - tw * 0.1), env.cloudCol[2] * (1 - tw * 0.3)];
    if (underwater) {
      env.fogCol = [0.07 * (0.3 + day), 0.27 * (0.3 + day), 0.5 * (0.3 + day)]; env.fogNear = 0; env.fogFar = 26;
      env.zen = env.hor = env.fogCol; env.starAlpha = 0; env.cloudAlpha = 0;
    }
    return env;
  }

  /* ---------- 카메라 ---------- */
  function lookDir(yaw, pitch) { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; }
  function computeCamera() {
    const ex = player.x, ey = player.eyeY, ez = player.z;
    let yaw = player.yaw, pitch = player.pitch, x = ex, y = ey, z = ez;
    const dir = lookDir(player.yaw, player.pitch);
    if (S.view > 0) {
      const sign = S.view === 1 ? -1 : 1;
      let dist = 4.6;
      for (let t = 0.3; t <= 4.6; t += 0.2) {
        const px = ex + dir[0] * t * sign, py = ey + dir[1] * t * sign, pz = ez + dir[2] * t * sign;
        if (SOLID[world.getBlock(Math.floor(px), Math.floor(py), Math.floor(pz))]) { dist = Math.max(0.4, t - 0.35); break; }
      }
      x = ex + dir[0] * dist * sign; y = ey + dir[1] * dist * sign + (S.view === 1 ? 0.2 : 0); z = ez + dir[2] * dist * sign;
      if (S.view === 2) { yaw += Math.PI; pitch = -pitch; }
    }
    if (st.shake > 0) { x += (Math.random() - 0.5) * st.shake * 0.3; y += (Math.random() - 0.5) * st.shake * 0.3; }
    return { x, y, z, yaw, pitch };
  }

  /* ---------- 상호작용 ---------- */
  function interact(dt, inp) {
    const dir = lookDir(player.yaw, player.pitch);
    st.target = world.raycast(player.x, player.eyeY, player.z, dir[0], dir[1], dir[2], 6);
    st.attackT = Math.max(0, st.attackT - dt);
    const t = st.target;
    if (inp.breakHeld && t) {
      st.breakT -= dt;
      if (st.breakT <= 0) {
        if (!Blocks.INFO[t.id].unbreakable) {
          spawnParticles(t.x, t.y, t.z, t.id);
          world.setBlock(t.x, t.y, t.z, B.AIR);
          if (PLANT[world.getBlock(t.x, t.y + 1, t.z)]) world.setBlock(t.x, t.y + 1, t.z, B.AIR);
          Sfx.play('break');
        }
        st.breakT = 0.2; st.attackT = 0.28;
      }
    } else if (!inp.breakHeld) st.breakT = 0;
    if (inp.placePressed && t) {
      const px = t.x + t.nx, py = t.y + t.ny, pz = t.z + t.nz, id = S.hotbar[st.sel], cur = world.getBlock(px, py, pz);
      if ((cur === B.AIR || cur === B.WATER || PLANT[cur]) && py > 0 && py < 127 && !(SOLID[id] && player.overlapsBlock(px, py, pz)) &&
        !(PLANT[id] && !SOLID[world.getBlock(px, py - 1, pz)])) {
        world.setBlock(px, py, pz, id); Sfx.play('place'); st.attackT = 0.28;
      }
    }
    if (inp.pickPressed && t && Blocks.PLACEABLE.includes(t.id)) { S.hotbar[st.sel] = t.id; Settings.save(); UI.buildHotbar(S.hotbar, st.sel); }
  }
  function spawnParticles(x, y, z, id) {
    const c = Blocks.avgColor(id);
    for (let i = 0; i < 14; i++) st.particles.push({
      x: x + Math.random(), y: y + Math.random(), z: z + Math.random(), vx: (Math.random() - 0.5) * 3.5, vy: Math.random() * 3.5 + 0.5, vz: (Math.random() - 0.5) * 3.5,
      life: 0.5 + Math.random() * 0.4, s: 0.05 + Math.random() * 0.07, c: [c[0] * (0.75 + Math.random() * 0.4), c[1] * (0.75 + Math.random() * 0.4), c[2] * (0.75 + Math.random() * 0.4)]
    });
  }

  /* ---------- 프레임 ---------- */
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now; dt = Math.min(dt, 0.05);
    if (dt > 0) st.fps = lerp(st.fps, 1 / dt, 0.05);
    st.time += dt;
    if (st.phase === 'start') { gfx.begin(0.04, 0.06, 0.14); return; }
    if (st.phase === 'loading') return loadingFrame();
    playFrame(dt);
  }

  function loadingFrame() {
    world.update(player.x, player.z, 22);
    const r = Math.min(world.R, 3), ratio = world.readyRatio(player.x, player.z, r);
    $('loadBar').style.width = Math.round(ratio * 100) + '%';
    $('loadText').textContent = world.stats.chunks + '개 청크 생성됨';
    gfx.begin(0.04, 0.06, 0.14);
    if (ratio >= 0.99 || performance.now() - st.loadStart > 25000) {
      st.phase = 'play'; st.paused = false;
      $('loading').classList.add('hidden'); $('hud').classList.remove('hidden');
      $('mobileUI').classList.toggle('active', S.device === 'mobile');
      controls.setEnabled(true); UI.setHearts(player.hp); UI.toast(S.device === 'mobile' ? '점프를 공중에서 한 번 더 누르면 활공!' : '공중에서 Space를 한 번 더 누르면 활공!', 3500);
    }
  }

  function playFrame(dt) {
    const inp = controls.poll();
    if (!st.paused) {
      player.yaw += inp.dyaw; player.pitch = clamp(player.pitch + inp.dpitch, -1.55, 1.55);
      if (inp.hotbarSet >= 0) selectSlot(inp.hotbarSet);
      if (inp.hotbarDelta) selectSlot((st.sel + inp.hotbarDelta + 9) % 9);
      if (S.dayCycle > 0) st.tod = (st.tod + dt / 300 * S.dayCycle) % 1;
      if (player.y < -15) st.deathCause = 'void';
      if (world.isLoaded(Math.floor(player.x), Math.floor(player.z))) player.update(dt, inp);
      interact(dt, inp);
      // 몸 방향
      const moving = player.speedH > 0.4;
      const hr = wrap(player.yaw - st.bodyYaw);
      if (S.view > 0 && moving && !player.gliding) st.bodyYaw += wrap(Math.atan2(-player.vx, -player.vz) - st.bodyYaw) * Math.min(1, dt * 10);
      else if (player.gliding || st.attackT > 0 || S.view === 0 || Math.abs(hr) > 1.2) st.bodyYaw += hr * Math.min(1, dt * (player.gliding ? 14 : 9));
      if (!st.hintShown && player.airTime > 0.6 && !player.gliding && player.energy > 50) { st.hintShown = true; }
    }
    st.shake = Math.max(0, st.shake - dt * 1.6);
    if (Net.active) {
      st.netT += dt;
      if (st.netT > 0.08) {
        st.netT = 0;
        const r2 = v => Math.round(v * 100) / 100;
        Net.sendState({ x: r2(player.x), y: r2(player.y), z: r2(player.z), by: r2(st.bodyYaw), yaw: r2(player.yaw), p: r2(player.pitch),
          g: player.glideAmt > 0.5 ? 1 : 0, og: player.onGround ? 1 : 0, a: st.attackT > 0 ? 1 : 0 });
      }
      updateRemotes(dt);
    }
    world.update(player.x, player.z, st.paused ? 6 : (S.device === 'mobile' ? 5 : 7));
    particlesUpdate(dt);

    /* UI */
    UI.setHearts(player.hp); UI.setWing(player.energy, player.maxEnergy); UI.setClock(st.tod);
    const cam = computeCamera();
    const headUnder = world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z)) === B.WATER;
    UI.setUnderwater(headUnder);
    $('crosshair').style.display = S.view === 0 ? '' : 'none';
    st.dbgT += dt;
    if (S.debug && st.dbgT > 0.25) {
      st.dbgT = 0;
      UI.setDebug('FPS ' + st.fps.toFixed(0) + '\nXYZ ' + player.x.toFixed(1) + ' ' + player.y.toFixed(1) + ' ' + player.z.toFixed(1) +
        '\n청크 ' + Math.floor(player.x / 16) + ',' + Math.floor(player.z / 16) + '  로드 ' + world.stats.chunks + '  거리 ' + world.R +
        '\nHP ' + player.hp + '/20  WING ' + player.energy.toFixed(0) + (player.gliding ? ' (활공)' : '') + '\n시드 ' + world.seed);
    }

    /* ---- 렌더 ---- */
    const fov = (S.fov + (player.gliding ? 8 : 0) + (inp.sprint && player.speedH > 5 ? 3 : 0)) * Math.PI / 180;
    st.fovCur = lerp(st.fovCur || fov, fov, Math.min(1, dt * 6));
    const far = Math.max(260, (world.R + 2) * 16 * 1.5);
    const P = Mat.persp(st.fovCur, gfx.aspect, 0.06, far);
    const vp = Mat.mul(P, Mat.mul(Mat.rotX(-cam.pitch), Mat.rotY(-cam.yaw)));
    const env = makeEnv(vp, cam, headUnder);
    gfx.begin(env.fogCol[0], env.fogCol[1], env.fogCol[2]);
    gfx.drawSky(env);
    const vis = world.drawOpaque(env, cam);

    gfx.beginEntities(vp, env, true);
    if (S.view > 0) drawPlayerBody(cam);
    if (Net.active) drawRemotes(cam);
    drawParticles(cam);
    drawTarget(cam);

    world.drawTranslucent(env, cam, vis);
    gfx.drawClouds(env);
    updateTags(vp, cam);

    if (S.view === 0 && !st.dead) {
      gfx.clearDepth();
      gfx.beginEntities(P, env, false);
      const sw = Math.sin(player.walkPhase) * Math.min(1, player.speedH / 5) * 0.05;
      Character.drawViewArm(gfx, S.app, st.time, sw, st.attackT > 0 ? 1 - st.attackT / 0.28 : 0);
    }
  }
  const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

  function drawPlayerBody(cam) {
    const M0 = Mat.mul(Mat.trans(player.x - cam.x, player.y - cam.y, player.z - cam.z), Mat.rotY(st.bodyYaw));
    const headYaw = clamp(wrap(player.yaw - st.bodyYaw), -1.1, 1.1);
    Character.drawBody(gfx, S.app, M0, {
      walk: player.walkPhase, swing: player.onGround ? Math.min(1, player.speedH / 4.5) * 0.85 : 0.15, glide: player.glideAmt,
      attack: st.attackT > 0 ? 1 - st.attackT / 0.28 : 0, headYaw, headPitch: clamp(player.pitch, -1.2, 1.2) * 0.8
    });
  }
  function particlesUpdate(dt) {
    const p = st.particles;
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i]; q.life -= dt; if (q.life <= 0) { p.splice(i, 1); continue; }
      q.vy -= 18 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
  }
  function drawParticles(cam) {
    for (const q of st.particles) gfx.drawBox(Mat.trans(q.x - cam.x, q.y - cam.y, q.z - cam.z), q.s, q.s, q.s, q.c, 0, Math.min(1, q.life * 3));
  }
  function drawTarget(cam) {
    const t = st.target; if (!t || st.paused) return;
    const X = t.x - cam.x, Y = t.y - cam.y, Z = t.z - cam.z, th = 0.014, col = [0.03, 0.04, 0.08], L = 1.012;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const o = -0.006 + a * 1.012, o2 = -0.006 + b * 1.012;
      gfx.drawBox(Mat.trans(X + 0.5, Y + o, Z + o2), L, th, th, col, 0, 0.7);
      gfx.drawBox(Mat.trans(X + o, Y + 0.5, Z + o2), th, L, th, col, 0, 0.7);
      gfx.drawBox(Mat.trans(X + o, Y + o2, Z + 0.5), th, th, L, col, 0, 0.7);
    }
    const f = 0.505;
    gfx.drawBox(Mat.trans(X + 0.5 + t.nx * f, Y + 0.5 + t.ny * f, Z + 0.5 + t.nz * f), t.nx ? 0.004 : 1, t.ny ? 0.004 : 1, t.nz ? 0.004 : 1, [1, 1, 1], 0.6, 0.16);
  }

  /* ================= 멀티플레이 ================= */
  const getEdits = () => Array.from(world.editLog, ([k, v]) => { const a = k.split(','); return [+a[0], +a[1], +a[2], v]; });
  function netStatus(msg, cls) { const e = $('netStatus'); e.textContent = msg; e.className = 'hint' + (cls ? ' ' + cls : ''); }
  function myName() { const n = ($('stName').value || S.name || '').trim().slice(0, 12) || '플레이어'; S.name = n; Settings.save(); return n; }

  function wireNet() {
    Net.cb = {
      getTod: () => st.tod, getApp: () => S.app, getEdits,
      onBlock: (x, y, z, b) => { if (world) world.setBlock(x, y, z, b, true); },
      onTime: t => { if (Math.abs(wrap((t - st.tod) * Math.PI * 2)) > 0.02) st.tod = t; },
      onJoin: p => { UI.toast(p.name + ' 님이 입장했어요', 2500); refreshNetUI(); },
      onLeave: p => { UI.toast(p.name + ' 님이 나갔어요', 2500); refreshNetUI(); },
      onDisconnect: () => { UI.toast('호스트와 연결이 끊겼어요. 혼자 계속 플레이해요', 4000); refreshNetUI(); }
    };
  }

  function refreshNetUI() {
    const chip = $('netChip'), info = $('mpInfo'), list = $('mpList');
    if (!Net.active) {
      chip.classList.add('hidden'); info.textContent = '혼자 플레이 중'; list.innerHTML = '';
      $('btnMpHost').classList.remove('hidden'); $('btnMpCopy').classList.add('hidden'); $('btnMpLeave').classList.add('hidden');
      for (const d of st.tags.values()) d.remove(); st.tags.clear(); return;
    }
    chip.classList.remove('hidden'); chip.textContent = '방 ' + Net.code + ' · ' + Net.count() + '명';
    info.textContent = (Net.isHost ? '방장 · ' : '참가 중 · ') + '방 코드 ' + Net.code + ' (' + Net.count() + '명)';
    const names = [Net.name + ' (나)'];
    for (const p of Net.players.values()) names.push(p.name);
    list.innerHTML = names.map(n => '<li>• ' + n.replace(/[<>&]/g, '') + '</li>').join('');
    $('btnMpHost').classList.add('hidden'); $('btnMpCopy').classList.remove('hidden'); $('btnMpLeave').classList.remove('hidden');
  }

  function setupMultiplayer() {
    wireNet();
    $('stCode').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    $('btnHost').addEventListener('click', async () => {
      netStatus('방을 만드는 중…');
      Sfx.unlock(); startGame();
      await hostRoom(true);
    });
    $('btnJoin').addEventListener('click', async () => {
      const code = $('stCode').value; Sfx.unlock();
      $('btnJoin').disabled = true; netStatus('연결 중…');
      try {
        const w = await Net.join(code, { name: myName(), app: S.app });
        netStatus('접속 성공! 월드를 불러오는 중…', 'ok');
        $('start').classList.add('hidden');
        controls.setMode(S.device || 'pc');
        newWorld(w.seed, true);
        for (const e of w.edits) world.setBlock(e[0], e[1], e[2], e[3], true);
        st.tod = w.tod; refreshNetUI();
        UI.toast('방 ' + Net.code + ' 에 참가했어요 (' + Net.count() + '명)', 3000);
        if (S.device === 'pc') controls.lock();
      } catch (e) { netStatus(e.message || String(e), 'err'); Net.leave(); }
      $('btnJoin').disabled = false;
    });
    $('btnMpHost').addEventListener('click', () => hostRoom(false));
    $('btnMpLeave').addEventListener('click', () => { Net.leave(); refreshNetUI(); UI.toast('연결을 끊었어요'); });
    $('btnMpCopy').addEventListener('click', () => {
      const t = Net.code; if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => UI.toast('코드 복사됨: ' + t)).catch(() => UI.toast('방 코드: ' + t)); else UI.toast('방 코드: ' + t);
    });
  }

  async function hostRoom(fromStart) {
    try {
      Net.name = myName();
      const code = await Net.host({ name: Net.name, app: S.app, seed: world.seed });
      refreshNetUI();
      UI.toast('방 코드: ' + code + ' — 친구에게 알려주세요!', 6000);
      if (!fromStart) UI.toast('방 코드: ' + code, 4000);
    } catch (e) {
      UI.toast('방을 만들지 못했어요: ' + (e.message || e), 5000);
    }
  }

  function updateRemotes(dt) {
    const k = Math.min(1, dt * 12);
    for (const p of Net.players.values()) {
      if (!p.init) continue;
      const ox = p.x, oz = p.z;
      p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.z += (p.tz - p.z) * k;
      p.by += wrap(p.tby - p.by) * k; p.yaw += wrap(p.tyaw - p.yaw) * k; p.pitch += (p.tp - p.pitch) * k;
      p.glide += (p.tg - p.glide) * Math.min(1, dt * 7);
      const sp = dt > 0 ? Math.hypot(p.x - ox, p.z - oz) / dt : 0;
      p.speed += (sp - p.speed) * Math.min(1, dt * 8);
      if (p.og) p.walk += p.speed * dt * 1.7;
    }
  }
  function drawRemotes(cam) {
    for (const p of Net.players.values()) {
      if (!p.init) continue;
      const dx = p.x - cam.x, dz = p.z - cam.z;
      if (dx * dx + dz * dz > 150 * 150) continue;
      const M0 = Mat.mul(Mat.trans(dx, p.y - cam.y, dz), Mat.rotY(p.by));
      Character.drawBody(gfx, p.app, M0, {
        walk: p.walk, swing: p.og ? Math.min(1, p.speed / 4.5) * 0.85 : 0.15, glide: p.glide,
        attack: p.atk ? 0.5 + 0.5 * Math.sin(st.time * 18) : 0, headYaw: clamp(wrap(p.yaw - p.by), -1.1, 1.1), headPitch: clamp(p.pitch, -1.2, 1.2) * 0.8
      });
    }
  }
  function updateTags(m, cam) {
    const box = $('tags');
    if (!Net.active) return;
    const W = window.innerWidth, H = window.innerHeight;
    for (const p of Net.players.values()) {
      let d = st.tags.get(p.id);
      if (!d) { d = document.createElement('div'); d.className = 'tag'; box.appendChild(d); st.tags.set(p.id, d); }
      if (d.textContent !== p.name) d.textContent = p.name;
      const x = p.x - cam.x, y = p.y + 2.15 - cam.y, z = p.z - cam.z;
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (!p.init || cw < 0.1 || cw > 70) { d.style.display = 'none'; continue; }
      const cx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / cw, cy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / cw;
      d.style.display = '';
      d.style.transform = 'translate(' + ((cx * 0.5 + 0.5) * W).toFixed(1) + 'px,' + ((1 - (cy * 0.5 + 0.5)) * H).toFixed(1) + 'px) translate(-50%,-100%)';
    }
    for (const [id, d] of st.tags) if (!Net.players.has(id)) { d.remove(); st.tags.delete(id); }
  }

  window.addEventListener('DOMContentLoaded', boot);
})(window.LUMINA);
