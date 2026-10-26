/* ===========================================================
 * gfx.js — 외부 라이브러리 없는 순수 WebGL 렌더러
 *  - 4x4 행렬 유틸 (열 우선, 카메라 상대 좌표계 사용)
 *  - 청크 / 엔티티(캐릭터·파티클) / 하늘(태양·달·별·구름) 셰이더
 * =========================================================== */
(function (G) {
  'use strict';

  /* ---------- 행렬 ---------- */
  const Mat = {
    ident() { const o = new Float32Array(16); o[0] = o[5] = o[10] = o[15] = 1; return o; },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) {
        const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
        for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
      }
      return o;
    },
    persp(fovy, asp, n, f) {
      const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
      o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
      return o;
    },
    rotX(a) { const o = Mat.ident(), c = Math.cos(a), s = Math.sin(a); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; },
    rotY(a) { const o = Mat.ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; },
    rotZ(a) { const o = Mat.ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; return o; },
    trans(x, y, z) { const o = Mat.ident(); o[12] = x; o[13] = y; o[14] = z; return o; },
    /** 절두체 평면 6개 (Gribb-Hartmann) */
    frustum(m) {
      const row = i => [m[i], m[4 + i], m[8 + i], m[12 + i]];
      const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
      const add = (a, b, s) => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2], a[3] + s * b[3]];
      return [add(r3, r0, 1), add(r3, r0, -1), add(r3, r1, 1), add(r3, r1, -1), add(r3, r2, 1), add(r3, r2, -1)];
    },
    aabbVisible(pl, x0, y0, z0, x1, y1, z1) {
      for (let i = 0; i < 6; i++) {
        const p = pl[i];
        const px = p[0] > 0 ? x1 : x0, py = p[1] > 0 ? y1 : y0, pz = p[2] > 0 ? z1 : z0;
        if (p[0] * px + p[1] * py + p[2] * pz + p[3] < 0) return false;
      }
      return true;
    }
  };

  /* ---------- 셰이더 소스 ---------- */
  const FSH = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';

  const SRC = {
    world: {
      attrs: ['aPos', 'aUV', 'aAux'],
      uniforms: ['uVP', 'uOff', 'uTex', 'uLight', 'uNight', 'uFogCol', 'uFog', 'uMode', 'uTime', 'uOrg'],
      vs: `
attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aAux;
uniform mat4 uVP; uniform vec3 uOff;
varying vec2 vUV; varying vec3 vAux; varying float vDist; varying vec3 vLocal;
void main(){
  vec3 p = aPos + uOff;
  vUV = aUV; vAux = aAux; vLocal = aPos; vDist = length(p);
  gl_Position = uVP * vec4(p, 1.0);
}`,
      fs: FSH + `
uniform sampler2D uTex; uniform vec3 uLight; uniform float uNight;
uniform vec3 uFogCol; uniform vec2 uFog; uniform float uMode; uniform float uTime; uniform vec2 uOrg;
varying vec2 vUV; varying vec3 vAux; varying float vDist; varying vec3 vLocal;
void main(){
  vec4 t = texture2D(uTex, vUV);
  if (uMode < 0.5 && t.a < 0.5) discard;
  float shade = vAux.x, emit = vAux.y, glow = vAux.z;
  vec3 c = t.rgb * shade * uLight;
  c += t.rgb * vec3(0.5, 0.85, 1.1) * glow * (0.25 + 0.9 * uNight);
  c = mix(c, t.rgb * 1.2, emit);
  float a = 1.0;
  if (uMode > 0.5) {
    a = t.a;
    if (uMode > 1.5) {
      vec2 w = uOrg + vLocal.xz;
      c += 0.055 * sin(w.x * 1.7 + uTime * 1.5) * sin(w.y * 1.9 + uTime * 1.2) + 0.03 * sin((w.x + w.y) * 0.8 + uTime);
    }
  }
  float f = smoothstep(uFog.x, uFog.y, vDist);
  c = mix(c, uFogCol, f);
  a = mix(a, 1.0, f * 0.85);
  gl_FragColor = vec4(c, a);
}`
    },
    entity: {
      attrs: ['aPos', 'aNor'],
      uniforms: ['uVP', 'uModel', 'uScale', 'uSun', 'uColor', 'uLight', 'uEmit', 'uFogCol', 'uFog', 'uAlpha'],
      vs: `
attribute vec3 aPos; attribute vec3 aNor;
uniform mat4 uVP; uniform mat4 uModel; uniform vec3 uScale; uniform vec3 uSun;
varying float vShade; varying float vDist;
void main(){
  vec4 wp = uModel * vec4(aPos * uScale, 1.0);
  vec3 n = normalize((uModel * vec4(aNor, 0.0)).xyz);
  float d = max(dot(n, uSun), 0.0);
  vShade = 0.56 + 0.44 * d - (n.y < -0.5 ? 0.12 : 0.0);
  vDist = length(wp.xyz);
  gl_Position = uVP * wp;
}`,
      fs: FSH + `
uniform vec3 uColor; uniform vec3 uLight; uniform float uEmit; uniform vec3 uFogCol; uniform vec2 uFog; uniform float uAlpha;
varying float vShade; varying float vDist;
void main(){
  vec3 c = uColor * vShade * uLight;
  c = mix(c, uColor * 1.15, uEmit);
  float f = smoothstep(uFog.x, uFog.y, vDist);
  c = mix(c, uFogCol, f);
  gl_FragColor = vec4(c, uAlpha);
}`
    },
    sky: {
      attrs: ['aPos'],
      uniforms: ['uVP', 'uZen', 'uHor', 'uSunDir', 'uSunCol', 'uSunGlow'],
      vs: `
attribute vec3 aPos; uniform mat4 uVP; varying vec3 vDir;
void main(){ vDir = aPos; vec4 p = uVP * vec4(aPos * 10.0, 1.0); gl_Position = p.xyww; }`,
      fs: FSH + `
uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunGlow;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float t = smoothstep(-0.02, 0.7, h);
  vec3 c = mix(uHor, uZen, pow(t, 0.72));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunCol * (pow(s, 6.0) * 0.22 + pow(s, 48.0) * 0.5) * uSunGlow;
  gl_FragColor = vec4(c, 1.0);
}`
    },
    disc: {
      attrs: ['aPos'],
      uniforms: ['uVP', 'uDir', 'uRight', 'uUp', 'uSize', 'uCol', 'uKind', 'uAlpha'],
      vs: `
attribute vec2 aPos; uniform mat4 uVP; uniform vec3 uDir; uniform vec3 uRight; uniform vec3 uUp; uniform float uSize;
varying vec2 vP;
void main(){
  vP = aPos;
  vec3 w = uDir * 50.0 + (uRight * aPos.x + uUp * aPos.y) * uSize * 50.0;
  vec4 p = uVP * vec4(w, 1.0); gl_Position = p.xyww;
}`,
      fs: FSH + `
uniform vec3 uCol; uniform float uKind; uniform float uAlpha; varying vec2 vP;
void main(){
  float d = length(vP); float a; vec3 c = uCol;
  if (uKind < 0.5) { a = smoothstep(1.0, 0.8, d) * 0.0 + step(d, 0.42) + exp(-d * 2.6) * 0.45; a = min(a, 1.0) * (1.0 - smoothstep(0.7, 1.0, d)); }
  else {
    a = smoothstep(0.46, 0.4, d);
    float cr = sin(vP.x * 23.0 + 1.3) * sin(vP.y * 19.0 + 0.4) + sin(vP.x * 41.0) * sin(vP.y * 37.0);
    c *= 0.88 + 0.07 * cr;
    a += exp(-d * 4.0) * 0.18;
  }
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0) * uAlpha);
}`
    },
    stars: {
      attrs: ['aPos', 'aSize'],
      uniforms: ['uVP', 'uAlpha', 'uPx'],
      vs: `
attribute vec3 aPos; attribute float aSize; uniform mat4 uVP; uniform float uPx;
void main(){ vec4 p = uVP * vec4(aPos * 20.0, 1.0); gl_Position = p.xyww; gl_PointSize = aSize * uPx; }`,
      fs: FSH + `
uniform float uAlpha;
void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(0.92, 0.95, 1.0, smoothstep(0.5, 0.05, d) * uAlpha); }`
    },
    cloud: {
      attrs: ['aPos'],
      uniforms: ['uVP', 'uCam', 'uY', 'uR', 'uTex', 'uCol', 'uAlpha'],
      vs: `
attribute vec2 aPos; uniform mat4 uVP; uniform vec2 uCam; uniform float uY; uniform float uR;
varying vec2 vUV; varying float vD;
void main(){
  vec3 rel = vec3(aPos.x * uR, uY, aPos.y * uR);
  vUV = (rel.xz + uCam) / 512.0;
  vD = length(aPos);
  gl_Position = uVP * vec4(rel, 1.0);
}`,
      fs: FSH + `
uniform sampler2D uTex; uniform vec3 uCol; uniform float uAlpha; varying vec2 vUV; varying float vD;
void main(){
  vec4 t = texture2D(uTex, vUV);
  float a = t.a * (1.0 - smoothstep(0.3, 0.95, vD)) * uAlpha;
  gl_FragColor = vec4(uCol * (0.9 + 0.1 * t.r), a);
}`
    }
  };

  function mkShader(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('셰이더 컴파일 실패: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function mkProgram(gl, def) {
    const p = gl.createProgram();
    gl.attachShader(p, mkShader(gl, gl.VERTEX_SHADER, def.vs));
    gl.attachShader(p, mkShader(gl, gl.FRAGMENT_SHADER, def.fs));
    def.attrs.forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('프로그램 링크 실패: ' + gl.getProgramInfoLog(p));
    const u = {};
    def.uniforms.forEach(n => { u[n] = gl.getUniformLocation(p, n); });
    return { p, u, nattr: def.attrs.length };
  }

  /* ---------- Gfx ---------- */
  class Gfx {
    constructor(canvas, opts) {
      opts = opts || {};
      const attr = { antialias: opts.antialias !== false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve };
      const gl = canvas.getContext('webgl2', attr) || canvas.getContext('webgl', attr) || canvas.getContext('experimental-webgl', attr);
      if (!gl) throw new Error('이 브라우저는 WebGL을 지원하지 않습니다.');
      this.gl = gl; this.canvas = canvas;
      if (!(typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)) gl.getExtension('OES_element_index_uint');
      this.prog = {};
      for (const k in SRC) this.prog[k] = mkProgram(gl, SRC[k]);
      this._enabled = 0;
      this._buildGeometry();
      this.atlasTex = null; this.cloudTex = null;
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    _buildGeometry() {
      const gl = this.gl;
      // 단위 큐브 (pos + normal)
      const faces = [
        [[1, 0, 0], [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]]],
        [[-1, 0, 0], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]]],
        [[0, 1, 0], [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]]],
        [[0, -1, 0], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]]],
        [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]],
        [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]]
      ];
      const cv = [];
      for (const [n, q] of faces) for (const i of [0, 1, 2, 0, 2, 3]) cv.push(...q[i], ...n);
      this.cube = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cube);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cv), gl.STATIC_DRAW);

      // 하늘 돔 (UV 구)
      const SEG = 28, RING = 14, sv = [], si = [];
      for (let y = 0; y <= RING; y++) {
        const phi = y / RING * Math.PI;
        for (let x = 0; x <= SEG; x++) {
          const th = x / SEG * Math.PI * 2;
          sv.push(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
        }
      }
      for (let y = 0; y < RING; y++) for (let x = 0; x < SEG; x++) {
        const a = y * (SEG + 1) + x, b = a + SEG + 1;
        si.push(a, b, a + 1, a + 1, b, b + 1);
      }
      this.dome = { vbo: gl.createBuffer(), ibo: gl.createBuffer(), n: si.length };
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dome.vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sv), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.dome.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(si), gl.STATIC_DRAW);

      // 쿼드 (-1..1)
      this.quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);

      // 별
      const rnd = (function (s) { return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })(12345);
      const st = [];
      for (let i = 0; i < 700; i++) {
        let x, y, z, l;
        do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 0.1);
        l = Math.sqrt(l); if (y / l < 0.02) { y = -y; }
        st.push(x / l, y / l, z / l, 1.2 + rnd() * rnd() * 3.2);
      }
      this.stars = gl.createBuffer(); this.starCount = 700;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.stars); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(st), gl.STATIC_DRAW);
    }

    _attribs(n) {
      const gl = this.gl;
      for (let i = this._enabled; i < n; i++) gl.enableVertexAttribArray(i);
      for (let i = n; i < this._enabled; i++) gl.disableVertexAttribArray(i);
      this._enabled = n;
    }

    resize(w, h) {
      this.canvas.width = Math.max(1, w | 0); this.canvas.height = Math.max(1, h | 0);
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    get aspect() { return this.canvas.width / this.canvas.height; }

    _makeTex(canvas, linear, repeat) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      const f = linear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
      const w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
      return t;
    }
    setAtlas(canvas) { this.atlasTex = this._makeTex(canvas, false, false); }
    setCloudTex(canvas) { this.cloudTex = this._makeTex(canvas, true, true); }

    createMesh(verts, idx) {
      const gl = this.gl, m = { vbo: gl.createBuffer(), ibo: gl.createBuffer(), n: idx.length };
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      return m;
    }
    deleteMesh(m) { if (!m) return; this.gl.deleteBuffer(m.vbo); this.gl.deleteBuffer(m.ibo); }

    /* ----- 프레임 ----- */
    begin(r, g, b) {
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(r, g, b, 1);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    clearDepth() { this.gl.depthMask(true); this.gl.clear(this.gl.DEPTH_BUFFER_BIT); }

    drawSky(env) {
      const gl = this.gl;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(false);
      // 돔
      let P = this.prog.sky; gl.useProgram(P.p); this._attribs(1);
      gl.uniformMatrix4fv(P.u.uVP, false, env.vp);
      gl.uniform3fv(P.u.uZen, env.zen); gl.uniform3fv(P.u.uHor, env.hor);
      gl.uniform3fv(P.u.uSunDir, env.sunDir); gl.uniform3fv(P.u.uSunCol, env.sunCol); gl.uniform1f(P.u.uSunGlow, env.sunGlow);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dome.vbo); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.dome.ibo);
      gl.drawElements(gl.TRIANGLES, this.dome.n, gl.UNSIGNED_SHORT, 0);
      gl.enable(gl.BLEND);
      // 별
      if (env.starAlpha > 0.01) {
        P = this.prog.stars; gl.useProgram(P.p); this._attribs(2);
        gl.uniformMatrix4fv(P.u.uVP, false, env.vp); gl.uniform1f(P.u.uAlpha, env.starAlpha); gl.uniform1f(P.u.uPx, env.pixelScale || 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.stars);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
        gl.drawArrays(gl.POINTS, 0, this.starCount);
      }
      // 태양 / 달
      P = this.prog.disc; gl.useProgram(P.p); this._attribs(1);
      gl.uniformMatrix4fv(P.u.uVP, false, env.vp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      const disc = (dir, kind, col, size, alpha) => {
        let rx = dir[2], ry = 0, rz = -dir[0]; const l = Math.hypot(rx, rz) || 1; rx /= l; rz /= l;
        const ux = dir[1] * rz - dir[2] * ry, uy = dir[2] * rx - dir[0] * rz, uz = dir[0] * ry - dir[1] * rx;
        gl.uniform3f(P.u.uDir, dir[0], dir[1], dir[2]); gl.uniform3f(P.u.uRight, rx, ry, rz); gl.uniform3f(P.u.uUp, ux, uy, uz);
        gl.uniform1f(P.u.uSize, size); gl.uniform3fv(P.u.uCol, col); gl.uniform1f(P.u.uKind, kind); gl.uniform1f(P.u.uAlpha, alpha);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      };
      if (env.sunDir[1] > -0.25) disc(env.sunDir, 0, env.sunDisc, 0.2, 1);
      const md = [-env.sunDir[0], -env.sunDir[1], -env.sunDir[2]];
      if (md[1] > -0.25) disc(md, 1, [0.93, 0.95, 1.0], 0.12, Math.min(1, env.starAlpha * 1.5));
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    }

    /* ----- 월드(청크) ----- */
    beginWorld(env) {
      const gl = this.gl, P = this.prog.world;
      gl.useProgram(P.p); this._attribs(3);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.uniform1i(P.u.uTex, 0);
      gl.uniformMatrix4fv(P.u.uVP, false, env.vp);
      gl.uniform3fv(P.u.uLight, env.light); gl.uniform1f(P.u.uNight, env.night);
      gl.uniform3fv(P.u.uFogCol, env.fogCol); gl.uniform2f(P.u.uFog, env.fogNear, env.fogFar);
      gl.uniform1f(P.u.uTime, env.time);
    }
    setWorldMode(mode) {
      const gl = this.gl, P = this.prog.world;
      gl.uniform1f(P.u.uMode, mode);
      if (mode === 0) { gl.disable(gl.BLEND); gl.depthMask(true); }
      else { gl.enable(gl.BLEND); gl.depthMask(false); }
    }
    drawChunk(m, ox, oy, oz, orgX, orgZ) {
      const gl = this.gl, P = this.prog.world;
      gl.uniform3f(P.u.uOff, ox, oy, oz);
      gl.uniform2f(P.u.uOrg, orgX, orgZ);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 12);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 20);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
      gl.drawElements(gl.TRIANGLES, m.n, gl.UNSIGNED_INT, 0);
    }

    /* ----- 엔티티(박스) ----- */
    beginEntities(vp, env, fogOn) {
      const gl = this.gl, P = this.prog.entity;
      gl.useProgram(P.p); this._attribs(2);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.depthMask(true);
      gl.uniformMatrix4fv(P.u.uVP, false, vp);
      gl.uniform3fv(P.u.uSun, env.sunLight); gl.uniform3fv(P.u.uLight, env.entLight);
      gl.uniform3fv(P.u.uFogCol, env.fogCol);
      gl.uniform2f(P.u.uFog, fogOn ? env.fogNear : 1e5, fogOn ? env.fogFar : 2e5);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cube);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    }
    /** M: 이동+회전 행렬(스케일 없음), sx/sy/sz: 크기 */
    drawBox(M, sx, sy, sz, col, emit, alpha) {
      const gl = this.gl, P = this.prog.entity;
      gl.uniformMatrix4fv(P.u.uModel, false, M);
      gl.uniform3f(P.u.uScale, sx, sy, sz);
      gl.uniform3f(P.u.uColor, col[0], col[1], col[2]);
      gl.uniform1f(P.u.uEmit, emit || 0);
      gl.uniform1f(P.u.uAlpha, alpha === undefined ? 1 : alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 36);
    }

    /* ----- 구름 ----- */
    drawClouds(env) {
      if (!this.cloudTex) return;
      const gl = this.gl, P = this.prog.cloud;
      gl.useProgram(P.p); this._attribs(1);
      gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cloudTex); gl.uniform1i(P.u.uTex, 0);
      gl.uniformMatrix4fv(P.u.uVP, false, env.vp);
      gl.uniform2f(P.u.uCam, env.cloudCam[0], env.cloudCam[1]);
      gl.uniform1f(P.u.uY, env.cloudY); gl.uniform1f(P.u.uR, env.cloudR);
      gl.uniform3fv(P.u.uCol, env.cloudCol); gl.uniform1f(P.u.uAlpha, env.cloudAlpha);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE);
    }
  }

  G.Mat = Mat;
  G.Gfx = Gfx;
})(window.LUMINA = window.LUMINA || {});
