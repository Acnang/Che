/* ===========================================================
 * net.js — 멀티플레이 (서버 없이 WebRTC P2P, PeerJS 사용)
 *  - 방장(호스트)이 방 코드를 만들고, 친구는 코드로 접속 (호스트 중심 스타 구조)
 *  - 월드는 시드로 같이 생성되고, 블록 편집·플레이어 위치·외형·시간만 동기화
 *  - ?net=local 로 열면 같은 브라우저의 다른 탭끼리 BroadcastChannel로 테스트 가능
 * =========================================================== */
(function (G) {
  'use strict';
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

  /* ---------- PeerJS 로더 ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src));
      document.head.appendChild(s);
    });
  }
  async function ensurePeer() {
    if (window.Peer) return;
    for (const u of ['https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js']) {
      try { await loadScript(u); if (window.Peer) return; } catch (e) { /* 다음 주소 시도 */ }
    }
    throw new Error('멀티플레이 모듈(PeerJS)을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
  }

  /* ---------- 전송 계층 1: WebRTC (PeerJS) ---------- */
  function wrapPeer(c, peer) {
    const o = { send(m) { try { c.send(m); } catch (e) { /* 끊김 */ } }, onmessage: null, onclose: null, close() { try { c.close(); if (peer) peer.destroy(); } catch (e) { /* */ } } };
    c.on('data', d => o.onmessage && o.onmessage(d));
    c.on('close', () => o.onclose && o.onclose());
    c.on('error', () => o.onclose && o.onclose());
    return o;
  }
  const PeerT = {
    async listen(code, onConn) {
      await ensurePeer();
      return new Promise((res, rej) => {
        const peer = new Peer('lumina-' + code);
        peer.on('open', () => res({ close() { peer.destroy(); } }));
        peer.on('error', e => rej(e));
        peer.on('connection', c => { const conn = wrapPeer(c); c.on('open', () => onConn(conn)); });
      });
    },
    async connect(code) {
      await ensurePeer();
      return new Promise((res, rej) => {
        const peer = new Peer();
        const to = setTimeout(() => { rej(new Error('연결 시간이 초과됐어요')); try { peer.destroy(); } catch (e) { /* */ } }, 14000);
        peer.on('open', () => {
          const c = peer.connect('lumina-' + code, { reliable: true });
          c.on('open', () => { clearTimeout(to); res(wrapPeer(c, peer)); });
        });
        peer.on('error', e => { clearTimeout(to); rej(new Error(e && e.type === 'peer-unavailable' ? '해당 방을 찾을 수 없어요 (코드를 확인해 주세요)' : '연결 오류: ' + (e && e.type || e))); });
      });
    }
  };

  /* ---------- 전송 계층 2: 같은 브라우저 탭끼리 (테스트용) ---------- */
  function mkLocal(ch, me, peer) {
    const o = { send(d) { ch.postMessage({ t: 'msg', to: peer, from: me, data: d }); }, onmessage: null, onclose: null, close() { ch.postMessage({ t: 'bye', to: peer, from: me }); } };
    return o;
  }
  const LocalT = {
    listen(code, onConn) {
      const ch = new BroadcastChannel('lumina-' + code), hid = 'h' + Math.random(), conns = {};
      ch.onmessage = e => {
        const m = e.data;
        if (m.t === 'conn') { const c = mkLocal(ch, hid, m.from); conns[m.from] = c; ch.postMessage({ t: 'ack', to: m.from, from: hid }); onConn(c); return; }
        if (m.to !== hid) return;
        const c = conns[m.from]; if (!c) return;
        if (m.t === 'msg') c.onmessage && c.onmessage(m.data);
        else if (m.t === 'bye') { c.onclose && c.onclose(); delete conns[m.from]; }
      };
      return Promise.resolve({ close() { ch.close(); } });
    },
    connect(code) {
      return new Promise((res, rej) => {
        const ch = new BroadcastChannel('lumina-' + code), gid = 'g' + Math.random(); let conn = null;
        const to = setTimeout(() => rej(new Error('해당 방을 찾을 수 없어요 (코드를 확인해 주세요)')), 2500);
        ch.onmessage = e => {
          const m = e.data; if (m.to !== gid) return;
          if (m.t === 'ack') { clearTimeout(to); conn = mkLocal(ch, gid, m.from); res(conn); }
          else if (m.t === 'msg' && conn) conn.onmessage && conn.onmessage(m.data);
          else if (m.t === 'bye' && conn) conn.onclose && conn.onclose();
        };
        ch.postMessage({ t: 'conn', from: gid });
      });
    }
  };
  const T = /[?&]net=local/.test(location.search) ? LocalT : PeerT;

  /* ---------- Net ---------- */
  const newRemote = (id, name, app) => ({ id, name: name || '플레이어', app: Object.assign({}, G.Character.DEFAULT_APP, app || {}),
    x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, by: 0, tby: 0, yaw: 0, tyaw: 0, pitch: 0, tp: 0, glide: 0, tg: 0, og: 1, walk: 0, speed: 0, atk: 0, init: false });
  function applyState(p, m) {
    p.tx = m.x; p.ty = m.y; p.tz = m.z; p.tby = m.by; p.tyaw = m.yaw; p.tp = m.p; p.tg = m.g; p.og = m.og; p.atk = m.a;
    if (!p.init) { p.x = m.x; p.y = m.y; p.z = m.z; p.by = m.by; p.yaw = m.yaw; p.pitch = m.p; p.init = true; }
  }

  const Net = {
    active: false, isHost: false, code: '', myId: '', name: '', players: new Map(), cb: {}, _conns: new Map(), _hostConn: null, _srv: null, _pid: 0, _iv: 0,

    count() { return this.players.size + 1; },

    async host(info) {
      this.leave(); this.isHost = true; this.myId = 'host'; this.name = info.name; this.seed = info.seed;
      let code = null, lastErr = null;
      for (let i = 0; i < 5 && !code; i++) {
        const c = randCode();
        try { this._srv = await T.listen(c, conn => this._onGuest(conn)); code = c; } catch (e) { lastErr = e; }
      }
      if (!code) throw new Error('방을 만들 수 없어요' + (lastErr && lastErr.message ? ': ' + lastErr.message : ''));
      this.code = code; this.active = true;
      this._iv = setInterval(() => this._bcast({ t: 'time', tod: this.cb.getTod() }), 4000);
      return code;
    },

    async join(code, info) {
      this.leave(); this.isHost = false; this.name = info.name;
      code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 4) throw new Error('방 코드를 입력해 주세요');
      const conn = await T.connect(code);
      this._hostConn = conn; this.code = code;
      return new Promise((res, rej) => {
        const to = setTimeout(() => { rej(new Error('호스트 응답이 없어요')); this.leave(); }, 9000);
        conn.onmessage = m => {
          if (m.t === 'welcome') { clearTimeout(to); this.active = true; this._welcome(m); res(m); } else this._onHostMsg(m);
        };
        conn.onclose = () => { clearTimeout(to); if (this.active) { this.leave(); this.cb.onDisconnect && this.cb.onDisconnect(); } else rej(new Error('연결이 끊어졌어요')); };
        conn.send({ t: 'hello', name: info.name, app: info.app });
      });
    },

    leave() {
      clearInterval(this._iv);
      for (const c of this._conns.values()) { try { c.close(); } catch (e) { /* */ } }
      this._conns.clear();
      if (this._hostConn) { try { this._hostConn.onclose = null; this._hostConn.close(); } catch (e) { /* */ } this._hostConn = null; }
      if (this._srv) { try { this._srv.close(); } catch (e) { /* */ } this._srv = null; }
      this.players.clear(); this.active = false; this.isHost = false; this.code = ''; this._pid = 0;
    },

    /* ----- 호스트 측 ----- */
    _bcast(msg, exceptId) { for (const [id, c] of this._conns) if (id !== exceptId) c.send(msg); },
    _onGuest(conn) {
      conn.onmessage = m => this._onGuestMsg(conn, m);
      conn.onclose = () => {
        if (!conn.pid) return;
        const p = this.players.get(conn.pid);
        this._conns.delete(conn.pid); this.players.delete(conn.pid);
        this._bcast({ t: 'leave', id: conn.pid });
        if (p && this.cb.onLeave) this.cb.onLeave(p);
      };
    },
    _onGuestMsg(conn, m) {
      switch (m.t) {
        case 'hello': {
          const id = 'p' + (++this._pid); conn.pid = id;
          const p = newRemote(id, String(m.name || '').slice(0, 12), m.app);
          const list = [{ id: 'host', name: this.name, app: this.cb.getApp() }];
          for (const q of this.players.values()) list.push({ id: q.id, name: q.name, app: q.app });
          this._conns.set(id, conn); this.players.set(id, p);
          conn.send({ t: 'welcome', id, seed: this.seed, edits: this.cb.getEdits(), players: list, tod: this.cb.getTod() });
          this._bcast({ t: 'join', id, name: p.name, app: p.app }, id);
          this.cb.onJoin && this.cb.onJoin(p);
          break;
        }
        case 'state': { const p = this.players.get(conn.pid); if (p) { applyState(p, m); this._bcast(Object.assign({}, m, { id: conn.pid }), conn.pid); } break; }
        case 'block': this.cb.onBlock(m.x, m.y, m.z, m.b); this._bcast(m, conn.pid); break;
        case 'app': { const p = this.players.get(conn.pid); if (p) { p.app = Object.assign({}, p.app, m.app); this._bcast({ t: 'app', id: conn.pid, app: p.app }, conn.pid); } break; }
      }
    },

    /* ----- 게스트 측 ----- */
    _welcome(m) {
      this.myId = m.id; this.players.clear();
      for (const q of m.players) if (q.id !== this.myId) this.players.set(q.id, newRemote(q.id, q.name, q.app));
    },
    _onHostMsg(m) {
      switch (m.t) {
        case 'join': { const p = newRemote(m.id, m.name, m.app); this.players.set(m.id, p); this.cb.onJoin && this.cb.onJoin(p); break; }
        case 'leave': { const p = this.players.get(m.id); this.players.delete(m.id); if (p && this.cb.onLeave) this.cb.onLeave(p); break; }
        case 'state': { const p = this.players.get(m.id); if (p) applyState(p, m); break; }
        case 'block': this.cb.onBlock(m.x, m.y, m.z, m.b); break;
        case 'app': { const p = this.players.get(m.id); if (p) p.app = Object.assign({}, p.app, m.app); break; }
        case 'time': this.cb.onTime && this.cb.onTime(m.tod); break;
      }
    },

    /* ----- 송신 ----- */
    sendState(s) { if (!this.active) return; s.t = 'state'; if (this.isHost) this._bcast(Object.assign({ id: 'host' }, s)); else if (this._hostConn) this._hostConn.send(s); },
    sendBlock(x, y, z, b) { if (!this.active) return; const m = { t: 'block', x, y, z, b }; if (this.isHost) this._bcast(m); else if (this._hostConn) this._hostConn.send(m); },
    sendApp(app) { if (!this.active) return; if (this.isHost) this._bcast({ t: 'app', id: 'host', app }); else if (this._hostConn) this._hostConn.send({ t: 'app', app }); }
  };

  // 호스트 자신도 원격 목록에 "host"로 보이도록, 게스트 측에서만 host 항목을 사용한다 (호스트 측 _bcast는 id:'host' 상태를 전송)
  G.Net = Net;
})(window.LUMINA = window.LUMINA || {});
