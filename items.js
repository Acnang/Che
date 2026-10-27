/* ===========================================================
 * items.js — 블록이 아닌 아이템(검·활·폭탄·갑옷) 정의와 아이콘
 * =========================================================== */
(function (G) {
  'use strict';
  const ITEM = { SWORD: 100, BOW: 101, BOMB: 102, ARMOR_IRON: 103, ARMOR_CRYSTAL: 104 };
  const DEFS = {
    100: { name: '크리스탈 검', tip: '좌클릭: 근접 공격 (피해 3칸)' },
    101: { name: '활', tip: '우클릭: 화살 발사' },
    102: { name: '폭탄', tip: '우클릭: 던지기 · 2초 뒤 폭발해 땅과 플레이어에 피해' },
    103: { name: '철 갑옷', tip: '우클릭: 착용/해제 · 받는 피해 -30%' },
    104: { name: '크리스탈 갑옷', tip: '우클릭: 착용/해제 · 받는 피해 -50%' }
  };
  const LIST = [100, 101, 102, 103, 104];
  const cache = {};

  function draw(id, S) {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); g.scale(S / 64, S / 64); g.lineJoin = 'round'; g.lineCap = 'round';
    const grad = (x0, y0, x1, y1, a, b) => { const q = g.createLinearGradient(x0, y0, x1, y1); q.addColorStop(0, a); q.addColorStop(1, b); return q; };
    if (id === ITEM.SWORD) {
      g.translate(32, 33); g.rotate(Math.PI / 4);
      g.fillStyle = grad(-6, 0, 6, 0, '#e9fbff', '#7fd0ee');
      g.beginPath(); g.moveTo(0, -33); g.lineTo(6, -24); g.lineTo(6, 8); g.lineTo(-6, 8); g.lineTo(-6, -24); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(-1.5, -26, 3, 32);
      g.fillStyle = '#f2c14e'; g.fillRect(-13, 8, 26, 5); g.fillStyle = '#c88f26'; g.fillRect(-13, 11, 26, 2);
      g.fillStyle = '#6b4426'; g.fillRect(-3.5, 13, 7, 13);
      g.fillStyle = '#f2c14e'; g.beginPath(); g.arc(0, 29, 4.2, 0, 7); g.fill();
      g.fillStyle = '#7be6ff'; g.beginPath(); g.arc(0, 29, 1.8, 0, 7); g.fill();
    } else if (id === ITEM.BOW) {
      g.strokeStyle = '#8a5a30'; g.lineWidth = 5.5; g.beginPath(); g.arc(14, 32, 26, -1.15, 1.15); g.stroke();
      g.strokeStyle = '#c99a62'; g.lineWidth = 2; g.beginPath(); g.arc(14, 32, 26, -1.15, 1.15); g.stroke();
      const ex = 14 + 26 * Math.cos(1.15), ey = 32 + 26 * Math.sin(1.15), sx = 14 + 26 * Math.cos(-1.15), sy = 32 + 26 * Math.sin(-1.15);
      g.strokeStyle = '#eef2ff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(sx, sy); g.lineTo(26, 32); g.lineTo(ex, ey); g.stroke();
      g.strokeStyle = '#d8c08a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(26, 32); g.lineTo(58, 32); g.stroke();
      g.fillStyle = '#cfe4ee'; g.beginPath(); g.moveTo(60, 32); g.lineTo(53, 28); g.lineTo(53, 36); g.closePath(); g.fill();
      g.fillStyle = '#ff7a8a'; g.fillRect(27, 29.5, 5, 5);
    } else if (id === ITEM.BOMB) {
      const rg = g.createRadialGradient(26, 34, 3, 30, 38, 22); rg.addColorStop(0, '#5b6078'); rg.addColorStop(1, '#14161f');
      g.fillStyle = rg; g.beginPath(); g.arc(30, 38, 20, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(22, 29, 5, 3, -0.6, 0, 7); g.fill();
      g.fillStyle = '#3a3d4d'; g.fillRect(25, 14, 10, 6);
      g.strokeStyle = '#c9b27a'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(30, 14); g.quadraticCurveTo(38, 6, 46, 11); g.stroke();
      g.fillStyle = '#ff9a2e'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 3 : 7; g.lineTo(48 + Math.cos(a) * r, 11 + Math.sin(a) * r); } g.closePath(); g.fill();
      g.fillStyle = '#fff3b0'; g.beginPath(); g.arc(48, 11, 2, 0, 7); g.fill();
    } else {
      const crystal = id === ITEM.ARMOR_CRYSTAL;
      g.fillStyle = crystal ? grad(8, 10, 56, 56, '#a8f4ff', '#8d7bff') : grad(8, 10, 56, 56, '#e6ebf5', '#7f8aa3');
      g.beginPath(); g.moveTo(20, 8); g.lineTo(28, 13); g.quadraticCurveTo(32, 18, 36, 13); g.lineTo(44, 8); g.lineTo(58, 17); g.lineTo(51, 31); g.lineTo(44, 28); g.lineTo(44, 56); g.lineTo(20, 56); g.lineTo(20, 28); g.lineTo(13, 31); g.lineTo(6, 17); g.closePath(); g.fill();
      g.strokeStyle = crystal ? 'rgba(255,255,255,.8)' : 'rgba(30,36,60,.55)'; g.lineWidth = 1.6; g.stroke();
      g.strokeStyle = crystal ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(32, 20); g.lineTo(32, 56); g.moveTo(20, 36); g.lineTo(44, 36); g.stroke();
      if (crystal) { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 24); g.lineTo(36, 30); g.lineTo(32, 36); g.lineTo(28, 30); g.closePath(); g.fill(); }
    }
    return c;
  }

  G.ITEM = ITEM;
  G.Items = {
    LIST, DEFS,
    isItem: id => id >= 100,
    name: id => (id >= 100 ? (DEFS[id] ? DEFS[id].name : '아이템') : G.Blocks.INFO[id].name),
    tip: id => (DEFS[id] ? DEFS[id].tip : ''),
    icon(id, size) {
      size = size || 48;
      if (id < 100) return G.Blocks.makeIcon(id, size);
      const k = id + ':' + size; return cache[k] || (cache[k] = draw(id, size));
    }
  };
})(window.LUMINA = window.LUMINA || {});
