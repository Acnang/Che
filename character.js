/* ===========================================================
 * character.js — 박스 기반 캐릭터 모델 + 커스터마이징
 *  피부/머리/상의/하의/신발/눈/날개 색, 머리 모양, 액세서리
 *  (게임 화면과 설정창 미리보기가 같은 코드를 사용)
 * =========================================================== */
(function (G) {
  'use strict';
  const { Mat } = G;

  const DEFAULT_APP = {
    skin: '#f0c4a0', hair: '#3b2a22', shirt: '#4f8cf2', pants: '#2f3650', shoes: '#eceff6',
    eyes: '#2c3f78', wings: '#7be6ff', hairStyle: 0, accessory: 0
  };
  const HAIR_STYLES = ['짧은 머리', '긴 머리', '뾰족 머리', '민머리'];
  const ACCESSORIES = ['없음', '안경', '왕관', '헤드폰'];
  const SWATCH = {
    skin: ['#fbe0c8', '#f0c4a0', '#d9a37c', '#b57c56', '#8a5a3b', '#5e3b26', '#cfe9d0', '#c9d5ff'],
    hair: ['#1d1a1a', '#3b2a22', '#6b4426', '#b8803a', '#e8c872', '#c4c7d0', '#d4476b', '#4a7de0', '#7a4de0', '#35c28f'],
    shirt: ['#4f8cf2', '#e0516b', '#3fbf8f', '#f2b84f', '#8a62e8', '#2b2f3d', '#f2f2f4', '#ee7f3e'],
    pants: ['#2f3650', '#1d1f27', '#4a5a7a', '#6b4a32', '#3b6e5a', '#8a8f9c', '#7d3c4f', '#d8cfae'],
    shoes: ['#eceff6', '#1d1f27', '#d9564e', '#3c6fd6', '#e0b13c', '#5e3b26'],
    eyes: ['#2c3f78', '#2e7d4f', '#6b4426', '#1d1a1a', '#7a4de0', '#38a8c9'],
    wings: ['#7be6ff', '#ff9ad5', '#ffd36b', '#a98bff', '#8bf5b3', '#ffffff', '#ff7a6b']
  };

  const rgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const mulc = (c, k) => [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];

  /**
   * 몸 전체 그리기
   * gfx.beginEntities()가 먼저 호출되어 있어야 한다.
   * M0: (카메라 상대 위치 이동) * (몸 yaw 회전)
   * st: { walk, swing, glide, attack, headYaw, headPitch }
   */
  function drawBody(gfx, app, M0, st) {
    const c = {
      skin: rgb(app.skin), hair: rgb(app.hair), shirt: rgb(app.shirt), pants: rgb(app.pants),
      shoes: rgb(app.shoes), eyes: rgb(app.eyes), wings: rgb(app.wings)
    };
    const T = Mat.trans, RX = Mat.rotX, RZ = Mat.rotZ, RY = Mat.rotY, mul = Mat.mul;
    const part = (M, ox, oy, oz, sx, sy, sz, col, emit, alpha) => gfx.drawBox(mul(M, T(ox, oy, oz)), sx, sy, sz, col, emit || 0, alpha);

    const g = st.glide || 0, A = st.swing || 0, ph = st.walk || 0;
    const IT = G.ITEM || {};
    const ar = st.armor === IT.ARMOR_HERO ? { c: [1, 0.8, 0.28], e: 0.3 } : st.armor === IT.ARMOR_CRYSTAL ? { c: [0.46, 0.88, 1.0], e: 0.45 } : st.armor === IT.ARMOR_IRON ? { c: [0.72, 0.76, 0.84], e: 0 } : null;
    // 몸 전체 기울기 (활공 시 앞으로 숙임)
    const MB = mul(M0, mul(T(0, 0.68, 0), mul(RX(-g * 0.55), T(0, -0.68, 0))));

    /* 다리 */
    for (const s of [-1, 1]) {
      const ang = Math.sin(ph) * A * s * 0.95 + g * 0.18;
      const ML = mul(MB, mul(T(s * 0.125, 0.68, 0), RX(ang)));
      part(ML, 0, -0.26, 0, 0.24, 0.52, 0.26, c.pants);
      part(ML, 0, -0.6, -0.015, 0.255, 0.16, 0.3, c.shoes);
      part(ML, 0, -0.675, -0.015, 0.26, 0.03, 0.305, mulc(c.shoes, 0.62));
      if (ar) { part(ML, 0, -0.2, 0, 0.275, 0.34, 0.295, ar.c, ar.e); part(ML, 0, -0.4, -0.01, 0.27, 0.07, 0.3, mulc(ar.c, 0.8), ar.e); }
    }
    /* 몸통 */
    part(MB, 0, 1.02, 0, 0.5, 0.68, 0.27, c.shirt);
    part(MB, 0, 0.715, 0, 0.51, 0.07, 0.28, mulc(c.pants, 1.15));
    part(MB, 0, 1.2, -0.139, 0.09, 0.09, 0.012, c.wings, 0.85);       // 가슴의 루미나 결정
    part(MB, 0, 1.33, 0, 0.3, 0.05, 0.28, mulc(c.shirt, 1.12));       // 칼라
    if (ar) { part(MB, 0, 1.05, 0, 0.56, 0.5, 0.32, ar.c, ar.e); part(MB, 0, 1.05, -0.165, 0.18, 0.3, 0.02, mulc(ar.c, 1.15), ar.e + 0.2); part(MB, 0, 0.78, 0, 0.58, 0.07, 0.33, mulc(ar.c, 0.75), ar.e); }
    /* 팔 */
    for (const s of [-1, 1]) {
      let ax = -Math.sin(ph) * A * s * 0.9, az = s * g * 1.25;
      if (s === 1 && st.attack > 0) ax = 0.25 + Math.sin(st.attack * Math.PI) * 1.9;
      const MA = mul(MB, mul(T(s * 0.335, 1.34, 0), mul(RZ(az), RX(ax))));
      part(MA, 0, -0.2, 0, 0.17, 0.4, 0.2, c.shirt);
      part(MA, 0, -0.54, 0, 0.16, 0.28, 0.19, c.skin);
      part(MA, 0, -0.395, 0, 0.175, 0.03, 0.205, mulc(c.shirt, 0.85));
      if (ar) { part(MA, 0, -0.03, 0, 0.24, 0.15, 0.26, ar.c, ar.e); part(MA, 0, -0.5, 0, 0.185, 0.14, 0.205, mulc(ar.c, 0.9), ar.e); }
      if (s === 1 && st.held) drawHeld(gfx, mul(MA, T(0, -0.62, 0)), st.held, 1.35);
    }
    /* 머리 */
    const MH = mul(MB, mul(T(0, 1.36, 0), mul(RY(st.headYaw || 0), RX(st.headPitch || 0))));
    part(MH, 0, 0.22, 0, 0.44, 0.44, 0.44, c.skin);
    // 얼굴 (정면 = -z)
    for (const s of [-1, 1]) {
      part(MH, s * 0.1, 0.235, -0.222, 0.1, 0.085, 0.012, [0.97, 0.98, 1]);
      part(MH, s * 0.09, 0.235, -0.2235, 0.055, 0.085, 0.012, c.eyes);
      part(MH, s * 0.09, 0.24, -0.2255, 0.022, 0.04, 0.012, [0.04, 0.05, 0.1]);
      part(MH, s * 0.1, 0.31, -0.222, 0.11, 0.022, 0.01, mulc(c.hair, 0.9));
      part(MH, s * 0.16, 0.15, -0.221, 0.06, 0.035, 0.008, mulc(c.skin, 1.0), 0, 1);
    }
    part(MH, 0, 0.11, -0.222, 0.1, 0.02, 0.01, mulc(c.skin, 0.62));
    part(MH, 0, 0.17, -0.226, 0.04, 0.05, 0.02, mulc(c.skin, 0.92));
    if (ar) {
      part(MH, 0, 0.3, 0, 0.5, 0.17, 0.5, ar.c, ar.e); part(MH, 0, 0.1, 0.215, 0.5, 0.38, 0.07, mulc(ar.c, 0.85), ar.e);
      part(MH, 0, 0.2, -0.235, 0.5, 0.05, 0.05, mulc(ar.c, 1.1), ar.e); part(MH, -0.235, 0.12, 0, 0.05, 0.3, 0.46, mulc(ar.c, 0.9), ar.e); part(MH, 0.235, 0.12, 0, 0.05, 0.3, 0.46, mulc(ar.c, 0.9), ar.e);
      if (st.armor === IT.ARMOR_CRYSTAL || st.armor === IT.ARMOR_HERO) part(MH, 0, 0.45, 0, 0.07, 0.16, 0.22, [0.9, 0.97, 1], 0.7);
    }
    // 머리카락
    const hair = c.hair;
    switch (app.hairStyle) {
      case 0:
        part(MH, 0, 0.19, 0.0, 0.47, 0.13, 0.47, hair);
        part(MH, 0, 0.05, 0.19, 0.47, 0.3, 0.1, hair);
        part(MH, 0, 0.255, -0.06, 0.47, 0.06, 0.4, mulc(hair, 1.12));
        part(MH, -0.225, 0.1, 0.05, 0.05, 0.22, 0.32, hair); part(MH, 0.225, 0.1, 0.05, 0.05, 0.22, 0.32, hair);
        part(MH, 0.0, 0.3, -0.225, 0.47, 0.08, 0.05, hair);
        break;
      case 1:
        part(MH, 0, 0.19, 0.0, 0.47, 0.13, 0.47, hair);
        part(MH, 0, -0.17, 0.19, 0.47, 0.8, 0.1, hair);
        part(MH, -0.235, -0.06, 0.1, 0.05, 0.55, 0.2, hair); part(MH, 0.235, -0.06, 0.1, 0.05, 0.55, 0.2, hair);
        part(MH, 0, 0.3, -0.225, 0.47, 0.08, 0.05, hair);
        part(MH, -0.16, 0.26, -0.228, 0.15, 0.1, 0.04, mulc(hair, 1.1));
        break;
      case 2:
        part(MH, 0, 0.2, 0, 0.46, 0.08, 0.46, hair);
        part(MH, 0, 0.06, 0.2, 0.46, 0.2, 0.08, hair);
        for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
          const hgt = 0.1 + ((ix * 7 + iz * 13 + 40) % 5) * 0.035;
          part(MH, ix * 0.15, 0.24 + hgt / 2, iz * 0.15, 0.11, hgt, 0.11, mulc(hair, 1 + (ix + iz) * 0.04));
        }
        break;
      default: break;
    }
    // 액세서리
    if (app.accessory === 1) {
      const fr = [0.08, 0.09, 0.12];
      for (const s of [-1, 1]) {
        part(MH, s * 0.1, 0.235, -0.232, 0.15, 0.115, 0.01, c.wings, 0.2, 0.28);
        part(MH, s * 0.1, 0.298, -0.232, 0.16, 0.014, 0.012, fr);
        part(MH, s * 0.1, 0.172, -0.232, 0.16, 0.014, 0.012, fr);
        part(MH, s * 0.178, 0.235, -0.232, 0.014, 0.12, 0.012, fr);
        part(MH, s * 0.022, 0.235, -0.232, 0.014, 0.12, 0.012, fr);
      }
      part(MH, 0, 0.255, -0.232, 0.05, 0.014, 0.012, fr);
      part(MH, 0.2, 0.25, -0.12, 0.012, 0.03, 0.2, fr); part(MH, -0.2, 0.25, -0.12, 0.012, 0.03, 0.2, fr);
    } else if (app.accessory === 2) {
      const gold = [1.0, 0.8, 0.28];
      part(MH, 0, 0.27, 0, 0.5, 0.07, 0.5, gold, 0.25);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) part(MH, x * 0.2, 0.34, z * 0.2, 0.08, 0.12, 0.08, gold, 0.25);
      part(MH, 0, 0.28, -0.255, 0.07, 0.07, 0.02, c.wings, 0.9);
    } else if (app.accessory === 3) {
      const hp = mulc(c.shirt, 0.7);
      part(MH, 0, 0.255, 0, 0.5, 0.045, 0.06, hp); part(MH, -0.245, 0.17, 0, 0.045, 0.2, 0.06, hp); part(MH, 0.245, 0.17, 0, 0.045, 0.2, 0.06, hp);
      for (const s of [-1, 1]) { part(MH, s * 0.27, 0.1, 0, 0.09, 0.2, 0.2, hp); part(MH, s * 0.31, 0.1, 0, 0.02, 0.12, 0.12, c.wings, 0.7); }
    }

    /* 날개: 접힘 → 활공 시 펼침 */
    const wl = 0.55 + g * 0.7, th = 0.16 + g * 1.38;
    for (const s of [-1, 1]) {
      const MW = mul(MB, mul(T(s * 0.13, 1.3, 0.165), RZ(s * th)));
      part(MW, 0, -wl / 2, 0, 0.05, wl, 0.05, mulc(c.wings, 0.55), 0.1);
      part(MW, s * -0.09, -wl * 0.47, 0.012, 0.2, wl * 0.92, 0.016, c.wings, 0.35, 0.82);
      part(MW, s * -0.1, -wl * 0.8, 0.02, 0.14, wl * 0.4, 0.014, mulc(c.wings, 1.15), 0.5, 0.7);
      part(MW, s * 0.005, -wl / 2, 0.012, 0.018, wl, 0.02, [1, 1, 1], 0.9, 0.9);
    }
  }

  /** 손에 든 아이템 (M: 손 위치, 팔 방향 = -y, rot: 앞으로 눕히는 각도) */
  function drawHeld(gfx, M, held, rot) {
    const I = G.ITEM; if (!held || held < 100) return;
    const Mi = Mat.mul(M, Mat.rotX(rot));
    const P = (ox, oy, oz, sx, sy, sz, col, em, al) => gfx.drawBox(Mat.mul(Mi, Mat.trans(ox, oy, oz)), sx, sy, sz, col, em || 0, al);
    if (held === I.SWORD || held === I.LAVA) {
      const lv = held === I.LAVA;
      P(0, -0.06, 0, 0.045, 0.18, 0.045, [0.42, 0.27, 0.16]); P(0, -0.17, 0, 0.21, 0.035, 0.07, [0.95, 0.78, 0.3], 0.2);
      P(0, -0.47, 0, 0.075, 0.56, 0.026, lv ? [1, 0.45, 0.12] : [0.8, 0.93, 1], lv ? 0.9 : 0.35); P(0, -0.77, 0, 0.045, 0.07, 0.022, [1, 1, 1], 0.7);
    } else if (held === I.BOW) {
      P(0, -0.04, 0, 0.04, 0.07, 0.62, [0.5, 0.33, 0.2]); P(0, -0.04, 0.3, 0.04, 0.06, 0.12, [0.62, 0.42, 0.25]); P(0, -0.04, -0.3, 0.04, 0.06, 0.12, [0.62, 0.42, 0.25]);
      P(0, 0.03, 0, 0.012, 0.012, 0.58, [0.95, 0.95, 0.98]);
    } else if (held === I.BOMB) {
      P(0, -0.11, 0, 0.23, 0.23, 0.23, [0.13, 0.14, 0.2]); P(0, -0.26, 0, 0.045, 0.09, 0.045, [0.65, 0.55, 0.32]); P(0, -0.32, 0, 0.07, 0.07, 0.07, [1, 0.55, 0.12], 1);
    }
  }

  /** 1인칭 오른팔 (뷰 공간) — vp = 투영 행렬만 */
  function drawViewArm(gfx, app, t, swing, attack, held) {
    const c = { skin: rgb(app.skin), shirt: rgb(app.shirt) };
    const bob = Math.sin(t * 1) * 0.0;
    let M = Mat.trans(0.3, -0.36 + bob, -0.5);
    M = Mat.mul(M, Mat.mul(Mat.rotX(1.18 + Math.sin((attack || 0) * Math.PI) * 0.75), Mat.rotZ(-0.12 - Math.sin((attack || 0) * Math.PI) * 0.15)));
    M = Mat.mul(M, Mat.trans(0, 0, 0));
    gfx.drawBox(Mat.mul(M, Mat.trans(0, -0.1, 0)), 0.11, 0.3, 0.13, c.shirt, 0);
    gfx.drawBox(Mat.mul(M, Mat.trans(0, -0.34, 0)), 0.105, 0.2, 0.125, c.skin, 0);
    if (held) drawHeld(gfx, Mat.mul(M, Mat.trans(0, -0.46, 0)), held, 0.3);
  }

  G.Character = { DEFAULT_APP, HAIR_STYLES, ACCESSORIES, SWATCH, drawBody, drawViewArm, drawHeld, rgb };
})(window.LUMINA = window.LUMINA || {});
