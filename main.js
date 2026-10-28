/* ===========================================================
 * main.js — 게임 루프: 환경(낮/밤), 카메라(1·3인칭), 상호작용, 렌더 순서
 * =========================================================== */
(function (G) {
  'use strict';
  const { Mat, Blocks, World, Player, Character, Controls, UI, Settings, Sfx, seedFrom, Net, Combat, Items, ITEM, CONFIG, sha256, Boss } = G;
  const { B, SOLID, PLANT, TARGET } = Blocks;
  const $ = id => document.getElementById(id);
  const S = Settings.data;

  let gfx, world, player, controls;
  const st = {
    phase: 'start', paused: true, menuOpen: false, invOpen: false, sel: 0, tod: 0.14, time: 0, target: null,
    breakT: 0, attackT: 0, bodyYaw: 0, particles: [], shake: 0, spawn: null, fps: 60, dbgT: 0, hintShown: false, loadStart: 0, deathCause: '', netT: 0, tags: new Map(), chatOpen: false, fixed: null, reconnecting: false, armorShown: -1
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
      onLockChange: locked => { if (!locked && st.phase === 'play' && !st.menuOpen && !st.invOpen && !st.dead && !st.chatOpen && controls.mode === 'pc') openMenu(); },
      onView: cycleView, onChat: openChat, onInventory: toggleInventory, onDebug: toggleDebug, onMenu: () => (st.menuOpen ? closeMenu() : openMenu())
    });
    controls.sens = S.sens;
    S.boss = S.boss || { wins: 0, unlocks: [] }; Items.setUnlocked(S.boss.unlocks);
    UI.init(); UI.initStart();
    if (!S.name) { S.name = '플레이어' + (100 + Math.floor(Math.random() * 900)); Settings.save(); }
    $('stName').value = S.name;
    Sfx.setVolume(S.volume / 100);
    UI.cb = {
      onDevice: d => { S.device = d; Settings.save(); controls.setMode(d); $('mobileUI').classList.toggle('active', st.phase === 'play' && d === 'mobile'); },
      onRenderDistance: r => { if (world) world.setRenderDistance(r); },
      onSens: v => { controls.sens = v; }, onResize: resize,
      onSetTime: t => { st.tod = t; UI.toast('시간 이동'); },
      onDebug: toggleDebug0, onNewWorld: seed => { if (Net.active) { UI.toast('멀티플레이 중에는 월드를 바꿀 수 없어요'); return; } newWorld(seed); }, onToSpawn: () => { teleportSpawn(); closeMenu(); },
      onResume: closeMenu, onInventory: toggleInventory, onMenu: () => openMenu(), onView: cycleView,
      onAppearance: () => { if (Net.active) Net.sendApp(S.app); }, onSelectSlot: selectSlot, onPickBlock: id => { S.hotbar[st.sel] = id; Settings.save(); UI.buildHotbar(S.hotbar, st.sel); toggleInventory(); },
      onRespawn: respawn
    };
    controls.setMode(S.device || 'pc');
    $('btnStart').addEventListener('click', () => startGame());
    setupMultiplayer(); setupChat(); setupCombat(); setupBoss();
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
    st.menuOpen = false; st.invOpen = false; st.particles.length = 0; Combat.reset(); closeChat(true);
    UI.showMenu(false); UI.showInventory(false); UI.showDeath(false);
    $('loading').classList.remove('hidden'); $('hud').classList.add('hidden'); $('mobileUI').classList.remove('active');
    controls.setEnabled(false);
    if (!first && S.device === 'pc') controls.lock();
    UI.buildHotbar(S.hotbar, st.sel); 
  }

  function wirePlayer() {
    player.onDamage = n => { UI.flashHurt(); Sfx.play('hurt'); st.shake = Math.min(0.5, 0.15 + n * 0.03); };
    player.onDeath = () => {
      st.dead = true; st.paused = true; closeChat(true);
      const hit = Combat.lastHit && st.time - Combat.lastHit.t < 8 ? Combat.lastHit : null, me = myName();
      $('deathTitle').textContent = '쓰러졌어요';
      const tgt = hit ? hit.by + (hit.by === '수정 군주' ? '에게' : ' 님에게') : '';
      UI.showDeath(true, hit ? tgt + ' 쓰러졌어요. 갑옷을 챙기고 다시 도전해 보세요!' : st.deathCause === 'void' ? '하늘 끝없이 떨어졌어요. 날개를 펴는 걸 잊지 마세요!' : '높은 곳에서 떨어졌어요. 공중에서 점프를 한 번 더 눌러 활공해 보세요.');
      const line = hit ? me + ' 님이 ' + tgt + ' 쓰러졌어요' : me + ' 님이 쓰러졌어요';
      addChat('', line, true); if (Net.active) Net.emit({ t: 'chat', sys: 1, name: '', text: line });
      controls.setEnabled(false); controls.unlock();
    };
    player.onLand = (dist, dmg) => { if (dist > 1.6) Sfx.play('land', dist); };
    player.onGlide = on => { if (on) Sfx.play('glide'); };
    player.onSplash = v => Sfx.play('splash');
  }

  function respawn() {
    player.respawn(Boss.inFight ? Boss.arenaSpawn() : (st.spawn || world.findSpawn())); st.dead = false; st.paused = false; st.deathCause = ''; Combat.lastHit = null;
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
  function selectSlot(i) { st.sel = clamp(i, 0, 8); UI.selectSlot(st.sel); { const id = S.hotbar[st.sel]; UI.toast(id >= 100 ? Items.name(id) + ' — ' + Items.tip(id) : Items.name(id), id >= 100 ? 2400 : 900); } Sfx.play('click'); }

  /* ---------- 환경 (낮/밤) ---------- */
  const C = {
    zenN: [0.025, 0.04, 0.11], zenD: [0.27, 0.5, 0.9], horN: [0.05, 0.07, 0.16], horD: [0.7, 0.84, 0.96],
    litN: [0.2, 0.24, 0.42], litD: [1, 1, 1]
  };
  function makeEnv(vp, cam, underwater) {
    const a = (Boss.inFight ? 0.8 : st.tod) * Math.PI * 2, s = Math.sin(a);
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
    if (Boss.inFight) {
      env.zen = [0.1, 0.02, 0.2]; env.hor = [0.34, 0.1, 0.42]; env.fogCol = env.hor.slice(); env.fogNear = 20; env.fogFar = 80; env.starAlpha = 1; env.cloudAlpha = 0.25;
      env.light = [0.55, 0.45, 0.75]; env.entLight = [0.9, 0.85, 1.05];
    }
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
    const t = st.target, held = S.hotbar[st.sel], isItem = held >= 100;
    const fighting = Combat.isSword(held) ? Combat.melee(inp.breakHeld, dt, held) : false, lockBuild = Boss.inFight;
    if (lockBuild && (inp.breakHeld || inp.placePressed) && !fighting && !isItem && st.time - (st.lockToast || 0) > 2) { st.lockToast = st.time; UI.toast('아레나에서는 블록을 바꿀 수 없어요'); }
    if (inp.breakHeld && t && !fighting && !lockBuild) {
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
    if (inp.placePressed || (inp.placeHeld && (held === ITEM.BOW || held === ITEM.BOMB))) {
      if (isItem) Combat.use(held, dt);
      else if (t && inp.placePressed && !lockBuild) {
        const px = t.x + t.nx, py = t.y + t.ny, pz = t.z + t.nz, id = held, cur = world.getBlock(px, py, pz);
        if ((cur === B.AIR || cur === B.WATER || PLANT[cur]) && py > 0 && py < 127 && !(SOLID[id] && player.overlapsBlock(px, py, pz)) &&
          !(PLANT[id] && !SOLID[world.getBlock(px, py - 1, pz)])) {
          world.setBlock(px, py, pz, id); Sfx.play('place'); st.attackT = 0.28;
        }
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
    Boss.tick(dt); bossUI(dt);
    if (st.phase === 'loading') return loadingFrame();
    playFrame(dt);
  }

  function loadingFrame() {
    world.update(player.x, player.z, 22);
    const r = Math.min(world.R, 3), ratio = world.readyRatio(player.x, player.z, r);
    $('loadBar').style.width = Math.round(ratio * 100) + '%';
    $('loadText').textContent = st.loadLabel || (world.stats.chunks + '개 청크 생성됨');
    gfx.begin(0.04, 0.06, 0.14);
    if (ratio >= 0.99 || performance.now() - st.loadStart > 25000) {
      st.phase = 'play'; st.paused = false; st.loadLabel = '';
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
      if (Boss.inFight && player.y < G.Arena.y - 9) { const s = Boss.arenaSpawn(); player.x = s.x; player.y = s.y + 0.5; player.z = s.z; player.vx = player.vy = player.vz = 0; player.fallPeak = player.y; player.invuln = Math.max(player.invuln, 1.5); UI.toast('아레나 가운데로 되돌려졌어요', 1500); }
      if (world.isLoaded(Math.floor(player.x), Math.floor(player.z))) player.update(dt, inp);
      interact(dt, inp);
      Combat.update(dt);
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
          g: player.glideAmt > 0.5 ? 1 : 0, og: player.onGround ? 1 : 0, a: st.attackT > 0 ? 1 : 0, hp: player.hp, h: S.hotbar[st.sel] >= 100 ? S.hotbar[st.sel] : 0, ar: Combat.armor, bw: S.boss.wins });
      }
      updateRemotes(dt);
    }
    world.update(player.x, player.z, st.paused ? 6 : (S.device === 'mobile' ? 5 : 7));
    particlesUpdate(dt);

    /* UI */
    UI.setHearts(player.hp); UI.setWing(player.energy, player.maxEnergy); UI.setClock(st.tod);
    if (st.armorShown !== Combat.armor) {
      st.armorShown = Combat.armor; const ac = $('armorChip'); ac.classList.toggle('hidden', !Combat.armor);
      if (Combat.armor) ac.textContent = Items.name(Combat.armor) + ' −' + Math.round(Combat.reduction() * 100) + '%';
    }
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
    Combat.draw(gfx, cam); Boss.draw(gfx, cam, st.time);
    drawTarget(cam);

    world.drawTranslucent(env, cam, vis);
    gfx.drawClouds(env);
    updateTags(vp, cam);

    if (S.view === 0 && !st.dead) {
      gfx.clearDepth();
      gfx.beginEntities(P, env, false);
      const sw = Math.sin(player.walkPhase) * Math.min(1, player.speedH / 5) * 0.05;
      Character.drawViewArm(gfx, S.app, st.time, sw, st.attackT > 0 ? 1 - st.attackT / 0.28 : 0, S.hotbar[st.sel] >= 100 ? S.hotbar[st.sel] : 0);
    }
  }
  const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

  function drawPlayerBody(cam) {
    const M0 = Mat.mul(Mat.trans(player.x - cam.x, player.y - cam.y, player.z - cam.z), Mat.rotY(st.bodyYaw));
    const headYaw = clamp(wrap(player.yaw - st.bodyYaw), -1.1, 1.1);
    Character.drawBody(gfx, S.app, M0, {
      walk: player.walkPhase, swing: player.onGround ? Math.min(1, player.speedH / 4.5) * 0.85 : 0.15, glide: player.glideAmt,
      attack: st.attackT > 0 ? 1 - st.attackT / 0.28 : 0, headYaw, headPitch: clamp(player.pitch, -1.2, 1.2) * 0.8,
      armor: Combat.armor, held: S.hotbar[st.sel] >= 100 ? S.hotbar[st.sel] : 0
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
      onJoin: p => { addChat('', p.name + ' 님이 입장했어요', true); refreshNetUI(); },
      onLeave: p => { addChat('', p.name + ' 님이 나갔어요', true); refreshNetUI(); },
      onEvent: onNetEvent, onReset: by => { addChat('', (by || '누군가') + ' 님이 월드를 초기화했어요', true); resetWorld(); },
      onDisconnect: () => { refreshNetUI(); if (st.fixed) reconnectFixed(); else UI.toast('호스트와 연결이 끊겼어요. 혼자 계속 플레이해요', 4000); }
    };
  }

  function refreshNetUI() {
    const chip = $('netChip'), info = $('mpInfo'), list = $('mpList');
    if (!Net.active) {
      chip.classList.add('hidden'); info.textContent = '혼자 플레이 중'; list.innerHTML = '';
      $('btnMpHost').classList.remove('hidden'); $('btnMpCopy').classList.add('hidden'); $('btnMpLeave').classList.add('hidden');
      for (const d of st.tags.values()) d.remove(); st.tags.clear(); return;
    }
    chip.classList.remove('hidden'); chip.textContent = (st.fixed ? st.fixed.name : '방 ' + Net.code) + ' · ' + Net.count() + '명';
    info.textContent = (st.fixed ? st.fixed.name + ' · ' : (Net.isHost ? '방장 · ' : '참가 중 · ') + '방 코드 ' + Net.code + ' ') + '(' + Net.count() + '명)';
    const names = [Net.name + ' (나)'];
    for (const p of Net.players.values()) names.push(p.name);
    list.innerHTML = names.map(n => '<li>• ' + n.replace(/[<>&]/g, '') + '</li>').join('');
    $('btnMpHost').classList.add('hidden'); $('btnMpCopy').classList.toggle('hidden', !!st.fixed); $('btnMpLeave').classList.remove('hidden');
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
    $('btnMpLeave').addEventListener('click', () => { st.fixed = null; Net.leave(); refreshNetUI(); UI.toast('연결을 끊었어요'); });
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


  /* ================= 채팅 · 명령어 · 초기화 ================= */
  function addChat(name, text, sys) {
    const li = document.createElement('li'); if (sys) li.className = 'sys';
    if (name && !sys) { const b = document.createElement('b'); b.textContent = name; li.appendChild(b); }
    li.appendChild(document.createTextNode(text));
    const log = $('chatLog'); log.appendChild(li); while (log.children.length > 40) log.firstChild.remove();
    setTimeout(() => li.classList.add('fade'), 9000);
  }
  function openChat() {
    if (st.phase !== 'play' || st.dead || st.menuOpen || st.invOpen || st.chatOpen) return;
    st.chatOpen = true; $('chat').classList.add('open'); $('chatForm').classList.remove('hidden');
    controls.setEnabled(false); controls.unlock(); $('chatInput').focus();
  }
  function closeChat(silent) {
    if (!st.chatOpen) return;
    st.chatOpen = false; $('chat').classList.remove('open'); $('chatForm').classList.add('hidden'); $('chatInput').value = ''; $('chatInput').blur();
    if (!silent && st.phase === 'play' && !st.menuOpen && !st.dead) { controls.setEnabled(true); if (S.device === 'pc') controls.lock(); }
  }
  function setupChat() {
    $('btnChat').addEventListener('click', openChat);
    $('chatForm').addEventListener('submit', e => { e.preventDefault(); const txt = $('chatInput').value.trim(); closeChat(); if (txt) sendChat(txt); });
    $('chatInput').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeChat(); } });
    addChat('', 'Enter 또는 T 로 채팅 · /도움말 로 명령어 보기', true);
  }
  function sendChat(txt) {
    if (txt[0] === '/') return runCommand(txt.slice(1).trim());
    const name = myName(); addChat(name, txt);
    if (Net.active) Net.emit({ t: 'chat', name, text: txt });
  }
  function runCommand(body) {
    const parts = body.split(/\s+/), cmd = parts[0];
    if (cmd === '도움말' || cmd === 'help') return addChat('', '/도움말 · /스폰 (스폰으로 이동) · /목록 (접속자) · /보스 (다음 보스전) — 우클릭: 활·폭탄·갑옷 사용, 좌클릭: 검 공격', true);
    if (cmd === '보스') { const s = Boss.status(); return addChat('', s.k === 'fight' ? '보스전 진행 중 (남은 ' + fmt(s.s) + ')' : '다음 보스전까지 ' + fmt(s.s), true); }
    if (cmd === '스폰') { teleportSpawn(); return addChat('', '스폰으로 이동했어요', true); }
    if (cmd === '목록') return addChat('', '접속자 ' + Net.count() + '명: ' + [myName()].concat(Array.from(Net.players.values(), p => p.name)).join(', '), true);
    if (cmd === '해시') return addChat('', '해시: ' + sha256(parts.slice(1).join(' ')) + '  (js/config.js 의 resetHash 에 붙여넣으세요)', true);
    // 비밀 명령어: 입력한 문장의 SHA-256 이 설정된 해시와 같으면 월드 초기화
    const h = sha256(body);
    if (h === CONFIG.resetHash) { if (!Net.requestReset(body, myName())) addChat('', '권한이 없어요', true); return; }
    if (h === CONFIG.bossHash) { if (!Net.requestBoss(body)) addChat('', '권한이 없어요', true); return; }
    addChat('', '알 수 없는 명령어예요. /도움말', true);
  }
  function resetWorld() {
    if (!world) return;
    newWorld(world.seed, true);
    UI.toast('월드가 초기화됐어요', 3000);
  }
  function onNetEvent(m) {
    switch (m.t) {
      case 'proj': Combat.onProj(m); break;
      case 'boom': Combat.boom(m); break;
      case 'hit': Combat.takeHit(m); break;
      case 'chat': addChat(m.name, m.text, m.sys); break;
      case 'boss': case 'bev': case 'bhit': case 'bjoin': Boss.onEvent(m); break;
    }
  }

  /* ================= PvP 연결 ================= */
  function setupCombat() {
    const burst = (x, y, z, c, n, sp) => {
      for (let i = 0; i < n; i++) st.particles.push({ x, y, z, vx: (Math.random() - 0.5) * sp * 2, vy: Math.random() * sp, vz: (Math.random() - 0.5) * sp * 2, life: 0.4 + Math.random() * 0.5, s: 0.06 + Math.random() * 0.1, c: [c[0], c[1], c[2]] });
    };
    Combat.init({
      look: () => { const d = lookDir(player.yaw, player.pitch); return { x: player.x, y: player.eyeY, z: player.z, dx: d[0], dy: d[1], dz: d[2] }; },
      world: () => world, player: () => player, swing: () => { st.attackT = 0.28; }, sfx: n => Sfx.play(n), burst,
      toast: t => UI.toast(t, 1600), myName, assist: () => controls.mode === 'mobile', inBoss: () => Boss.inFight, shake: v => { st.shake = Math.max(st.shake, v); }, time: () => st.time
    });
    $('btnSrv0').addEventListener('click', () => enterServer(0));
    $('btnSrv1').addEventListener('click', () => enterServer(1));
    CONFIG.servers.forEach((s, i) => { const b = $('btnSrv' + i); if (b) b.innerHTML = '<b>' + s.name + '</b><small>확인 중…</small>'; });
    refreshServers(); setInterval(refreshServers, 12000);
  }


  /* ================= 보스전 연결 ================= */
  const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  function banner(text) { const b = $('banner'); b.textContent = text; b.classList.add('on'); clearTimeout(st.bannerT); st.bannerT = setTimeout(() => b.classList.remove('on'), 3600); }
  function showInvite() {
    if (Boss.phase !== 'invite' || Boss.joined) return;
    $('invite').classList.remove('hidden'); Sfx.play('respawn'); addChat('', '⚔ 보스전 초대! ' + (S.device === 'mobile' ? '카드의 버튼으로 선택하세요' : '[Y] 참여 · [N] 패스'), true);
  }
  function teleportTo(x, y, z, label) {
    closeChat(true); st.menuOpen = false; st.invOpen = false; UI.showMenu(false); UI.showInventory(false);
    if (st.dead) { st.dead = false; UI.showDeath(false); player.respawn({ x, y, z }); }
    player.x = x; player.y = y + 0.3; player.z = z; player.vx = player.vy = player.vz = 0; player.fallPeak = player.y; player.hp = player.maxHp; player.invuln = Math.max(player.invuln, 3);
    st.phase = 'loading'; st.paused = true; st.loadStart = performance.now(); st.loadLabel = label;
    $('loading').classList.remove('hidden'); $('hud').classList.add('hidden'); $('mobileUI').classList.remove('active'); controls.setEnabled(false);
  }
  function setupBoss() {
    Boss.init({
      player: () => player, toast: (t, ms) => UI.toast(t, ms), chat: t => addChat('', t, true), sfx: n => Sfx.play(n), banner,
      burst: (x, y, z, c, n, sp) => { for (let i = 0; i < n; i++) st.particles.push({ x, y, z, vx: (Math.random() - 0.5) * sp * 2, vy: Math.random() * sp, vz: (Math.random() - 0.5) * sp * 2, life: 0.4 + Math.random() * 0.6, s: 0.07 + Math.random() * 0.1, c: [c[0], c[1], c[2]] }); },
      shake: v => { st.shake = Math.max(st.shake, v); },
      invite: showInvite, hideInvite: () => $('invite').classList.add('hidden'),
      hurt: (raw, kx, kz) => {
        if (player.dead) return;
        Combat.lastHit = { by: '수정 군주', t: st.time };
        player.vx += (kx || 0) * 0.5; player.vz += (kz || 0) * 0.5; if (kx || kz) { player.vy = Math.max(player.vy, 4); player.onGround = false; }
        player.damage(Math.max(1, Math.round(raw * (1 - Combat.reduction()))));
      },
      bar: (hp, max) => { $('bossBar').classList.remove('hidden'); $('bossFill').style.transform = 'scaleX(' + Math.max(0, hp / max) + ')'; $('bossHp').textContent = Math.ceil(hp) + ' / ' + max; },
      hideBar: () => $('bossBar').classList.add('hidden'),
      enterArena: (x, y, z) => { st.retPos = { x: player.x, y: player.y, z: player.z }; teleportTo(x, y, z, '보스 아레나로 이동 중…'); addChat('', '아레나로 이동! 화염구는 피하고, 빨간 원이 나타나면 점프하세요', true); },
      leaveArena: () => { const r = st.retPos || st.spawn || world.findSpawn(); teleportTo(r.x, r.y, r.z, '돌아가는 중…'); },
      reward: bossReward
    });
    $('invYes').addEventListener('click', () => Boss.accept()); $('invNo').addEventListener('click', () => Boss.decline());
    $('bossChip').addEventListener('click', () => { if (Boss.phase === 'invite' && !Boss.joined) { Boss.declined = false; showInvite(); } else { const s = Boss.status(); UI.toast(s.k === 'fight' ? '보스전 진행 중' : '보스전은 30분마다 열려요 · 1분 전에 참여를 고를 수 있어요', 2600); } });
    window.addEventListener('keydown', e => {
      if (st.chatOpen || $('invite').classList.contains('hidden') || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName))) return;
      if (e.code === 'KeyY') Boss.accept(); else if (e.code === 'KeyN') Boss.decline();
    });
  }
  function bossReward() {
    const bs = S.boss; bs.wins++; const got = [];
    if (bs.wins >= 1 && !bs.unlocks.includes(ITEM.ARMOR_HERO)) { bs.unlocks.push(ITEM.ARMOR_HERO); got.push('영웅 갑옷'); }
    if (bs.wins >= 3 && !bs.unlocks.includes(ITEM.LAVA)) { bs.unlocks.push(ITEM.LAVA); got.push('용암 검'); }
    Settings.save(); Items.setUnlocked(bs.unlocks); UI.buildInventory();
    banner('보스 처치! ★' + bs.wins); Sfx.play('respawn');
    addChat('', '보스 클리어 보상: 칭호 ★' + bs.wins + (got.length ? ' · 새 아이템 해금: ' + got.join(', ') + ' (E 키로 선택)' : (bs.wins < 3 ? ' · 3회 클리어하면 용암 검!' : '')), true);
    if (got.length) UI.toast('해금: ' + got.join(', ') + ' — E 키(모바일은 블록 버튼)에서 꺼내 쓰세요', 6000);
  }
  /** 보스 타이머 칩 · 초대 카운트다운 · 모바일 버튼 라벨 */
  function bossUI(dt) {
    st.bossUiT = (st.bossUiT || 0) - dt; if (st.bossUiT > 0) return; st.bossUiT = 0.25;
    const s = Boss.status(), chip = $('bossChip');
    chip.textContent = s.k === 'fight' ? '보스전 ' + fmt(s.s) : s.k === 'invite' ? '보스 · ' + (Boss.joined ? '참여 확정 ' : '참여 마감 ') + s.s + '초' : '보스 ' + fmt(s.s);
    chip.classList.toggle('hot', s.k !== 'idle');
    if (s.k === 'invite') $('invCount').textContent = s.s;
    const id = S.hotbar[st.sel];
    if (st.heldShown !== id) {
      st.heldShown = id;
      const sw = Combat.isSword(id), bk = $('btnBreak').querySelector('small'), pl = $('btnPlace').querySelector('small');
      if (bk) bk.textContent = sw ? '공격' : '부수기';
      if (pl) pl.textContent = id === ITEM.BOW ? '발사' : id === ITEM.BOMB ? '던지기' : Combat.isArmor(id) ? '착용' : sw ? '—' : '놓기';
    }
  }

  /* ---------- 고정 서버 ---------- */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function applyWelcome(w) {
    newWorld(w.seed, true);
    for (const e of w.edits) world.setBlock(e[0], e[1], e[2], e[3], true);
    st.tod = w.tod;
  }
  async function refreshServers() {
    if (st.phase !== 'start' || st.connecting || Net.active) return;
    await Promise.all(CONFIG.servers.map(async (s, i) => {
      const n = await Net.probe(s.code), b = $('btnSrv' + i); if (!b || st.phase !== 'start' || st.connecting) return;
      const sm = b.querySelector('small'); if (sm) sm.textContent = n > 0 ? n + '명 접속 중' : n === 0 ? '비어 있음 · 내가 열기' : '확인 실패';
    }));
  }
  async function enterServer(i) {
    const srv = CONFIG.servers[i]; Sfx.unlock(); st.connecting = true;
    const btns = ['btnSrv0', 'btnSrv1', 'btnStart', 'btnHost', 'btnJoin'].map($);
    btns.forEach(b => { b.disabled = true; });
    netStatus(srv.name + ' 접속 중…'); S.name = myName(); S.renderDistance = +$('stRd').value; Settings.save();
    controls.setMode(S.device || 'pc');
    try { if (S.device === 'mobile' && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {}); } catch (e) { /* ignore */ }
    try {
      const r = await Net.enterFixed(srv, { name: S.name, app: S.app }, { beforeHost: async () => { $('start').classList.add('hidden'); newWorld(srv.seed, true); return world.seed; } });
      st.fixed = srv;
      if (r.role === 'guest') { $('start').classList.add('hidden'); applyWelcome(r.welcome); UI.toast(srv.name + ' 에 참가했어요 (' + Net.count() + '명)', 3500); }
      else UI.toast(srv.name + ' 을(를) 열었어요 — 다른 사람이 들어올 수 있어요', 4000);
      refreshNetUI(); netStatus('');
      if (S.device === 'pc') controls.lock();
    } catch (e) {
      netStatus(e.message || String(e), 'err'); Net.leave(); st.fixed = null;
      if (st.phase !== 'start') { st.phase = 'start'; $('start').classList.remove('hidden'); $('loading').classList.add('hidden'); $('hud').classList.add('hidden'); controls.setEnabled(false); }
    }
    btns.forEach(b => { b.disabled = false; }); st.connecting = false; refreshServers();
  }
  /** 방장이 나가면: 남은 사람 중 먼저 성공한 쪽이 새 방장이 되고 나머지는 다시 붙는다 */
  async function reconnectFixed() {
    const srv = st.fixed; if (!srv || st.reconnecting) return;
    st.reconnecting = true; UI.toast('서버 연결이 끊겼어요. 다시 접속 중…', 3000);
    await sleep(300 + Math.random() * 1600);
    try {
      if (!st.fixed) { st.reconnecting = false; return; }
      const r = await Net.enterFixed(srv, { name: myName(), app: S.app }, { beforeHost: async () => world.seed });
      if (r.role === 'guest') { for (const e of r.welcome.edits) world.setBlock(e[0], e[1], e[2], e[3], true); st.tod = r.welcome.tod; UI.toast(srv.name + ' 에 다시 연결됐어요', 3000); }
      else UI.toast('이 서버의 방장이 됐어요', 3500);
      refreshNetUI();
    } catch (e) { UI.toast('서버에 다시 연결하지 못했어요: ' + (e.message || e), 5000); st.fixed = null; refreshNetUI(); }
    st.reconnecting = false;
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
      if (!p.init || p.hp <= 0) continue;
      const dx = p.x - cam.x, dz = p.z - cam.z;
      if (dx * dx + dz * dz > 150 * 150) continue;
      const M0 = Mat.mul(Mat.trans(dx, p.y - cam.y, dz), Mat.rotY(p.by));
      Character.drawBody(gfx, p.app, M0, {
        walk: p.walk, swing: p.og ? Math.min(1, p.speed / 4.5) * 0.85 : 0.15, glide: p.glide,
        attack: p.atk ? 0.5 + 0.5 * Math.sin(st.time * 18) : 0, headYaw: clamp(wrap(p.yaw - p.by), -1.1, 1.1), headPitch: clamp(p.pitch, -1.2, 1.2) * 0.8, armor: p.armor, held: p.held
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
      const label = (p.bw ? '★' + p.bw + ' ' : '') + (p.hp > 0 && p.hp < 20 ? p.name + '  ♥' + p.hp : p.name);
      if (d.textContent !== label) d.textContent = label;
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
