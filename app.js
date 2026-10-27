/*!
 * app.js — 画面まわり。操作と描画はここに書く。
 * はしごの形と行き先は core.js が決める。ここは見せ方だけ。
 */
(function () {
  'use strict';

  const C = window.Core;
  const $ = (s) => document.querySelector(s);
  const COLORS = ['#E4572E', '#F2B134', '#7DBB6B', '#3FA7C4', '#E68AA6', '#9A86D6',
    '#F28B50', '#58B89F', '#C9A15B', '#6C8FD9', '#D96C8E', '#A7C957'];
  const STORE = 'amida1';
  const VERT_FROM = 6;     // この人数から名前と結果を縦に積む
  let speed = 420;         // 線をたどる速さ (px/秒)

  /* ---------------- 設定 (保存する) ---------------- */
  const S = { n: 6, names: [], results: [], sound: true, hide: true };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && typeof saved === 'object') {
      if (Number.isFinite(saved.n)) S.n = C.clampN(saved.n);
      if (Array.isArray(saved.names)) S.names = saved.names.map(String);
      if (Array.isArray(saved.results)) S.results = saved.results.map(String);
      if (typeof saved.sound === 'boolean') S.sound = saved.sound;
      if (typeof saved.hide === 'boolean') S.hide = saved.hide;
    }
  } catch (e) { /* 読めなければ初期値のまま */ }

  // 打つたびに書かず、少しまとめてから書く
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* 保存できなくても遊べる */ }
  }
  window.addEventListener('pagehide', saveNow);

  function fit() {
    const f = C.fitLists(S.names, S.results, S.n);
    S.names = f.names;
    S.results = f.results;
  }

  /* ---------------- せってい画面 ---------------- */
  function renderSetup() {
    fit();
    $('#cnt').textContent = S.n;
    $('#minus').disabled = S.n <= C.MIN_N;
    $('#plus').disabled = S.n >= C.MAX_N;
    const box = $('#rows');
    box.textContent = '';
    for (let i = 0; i < S.n; i++) {
      const row = document.createElement('div');
      row.className = 'row';
      const dot = document.createElement('i');
      dot.style.background = COLORS[i];
      const nm = document.createElement('input');
      nm.className = 'nm'; nm.maxLength = 6; nm.value = S.names[i];
      nm.setAttribute('aria-label', 'なまえ ' + (i + 1));
      nm.addEventListener('input', () => { S.names[i] = nm.value; save(); });
      const ar = document.createElement('span');
      ar.className = 'arrow';
      const rs = document.createElement('input');
      rs.className = 'rs'; rs.maxLength = 8; rs.value = S.results[i]; rs.placeholder = 'けっか';
      rs.setAttribute('aria-label', 'けっか ' + (i + 1));
      rs.addEventListener('input', () => { S.results[i] = rs.value; save(); });
      row.append(dot, nm, ar, rs);
      box.appendChild(row);
    }
  }

  /* ---------------- はしご ---------------- */
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  let G = null;            // { seed, ladder, slot: 縦線ごとの結果, paths }
  let P = [];              // 人ごとの進み具合
  let raf = 0;

  function newGame() {
    const seed = (Math.random() * 4294967296) >>> 0;
    const rng = C.mulberry32(seed);
    const ladder = C.makeLadder(S.n, rng);
    G = {
      seed: seed,
      ladder: ladder,
      slot: C.shuffle(S.results.slice(), rng),
      paths: [...Array(ladder.n).keys()].map((i) => C.trace(ladder, i))
    };
    P = G.paths.map(() => ({ t: 0, run: false, done: false, startAt: 0, prev: 0, ticked: 0 }));
  }

  function geom() {
    const W = cv.clientWidth, H = cv.clientHeight, pad = 6, n = G.ladder.n, R = G.ladder.rows.length;
    return {
      W: W, H: H,
      x: (c) => (c + 0.5) * W / n,
      y: (r) => pad + (r + 0.5) * (H - 2 * pad) / R
    };
  }

  /** 人 i の通り道を、画面上の点の並びにする。hs は横線に入った所までの長さ */
  function pathOf(i, g) {
    const tr = G.paths[i];
    const pts = [{ x: g.x(i), y: 0 }];
    for (const turn of tr.turns) {
      pts.push({ x: g.x(turn.from), y: g.y(turn.row) }, { x: g.x(turn.to), y: g.y(turn.row) });
    }
    pts.push({ x: g.x(tr.end), y: g.H });
    const cum = [0], hs = [];
    for (let k = 1; k < pts.length; k++) {
      cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
      if (pts[k].y === pts[k - 1].y) hs.push(cum[k - 1]);
    }
    return { pts: pts, cum: cum, total: cum[cum.length - 1], end: tr.end, hs: hs };
  }

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!(w >= 1 && h >= 1)) return;   // 組み直し中の 0 は無視する
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function strokePartial(path, t, color, w) {
    const pts = path.pts;
    let hx = pts[0].x, hy = pts[0].y;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    for (let k = 1; k < pts.length; k++) {
      if (t >= path.cum[k]) {
        hx = pts[k].x; hy = pts[k].y;
        ctx.lineTo(hx, hy);
      } else {
        const f = (t - path.cum[k - 1]) / (path.cum[k] - path.cum[k - 1]);
        hx = pts[k - 1].x + (pts[k].x - pts[k - 1].x) * f;
        hy = pts[k - 1].y + (pts[k].y - pts[k - 1].y) * f;
        ctx.lineTo(hx, hy);
        break;
      }
    }
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.stroke();
    return [hx, hy];
  }

  function draw() {
    if (!G || $('#play').hidden) return;
    const g = geom(), n = G.ladder.n, rows = G.ladder.rows;
    ctx.clearRect(0, 0, g.W, g.H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = cssVar('--line'), bg = cssVar('--bg');
    ctx.strokeStyle = line;
    ctx.lineWidth = 2.5;
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(g.x(i), 0); ctx.lineTo(g.x(i), g.H); ctx.stroke();
    }
    if (!S.hide) {
      ctx.globalAlpha = 0.7;
      for (let r = 0; r < rows.length; r++) {
        for (let i = 0; i < n - 1; i++) {
          if (!rows[r][i]) continue;
          ctx.beginPath(); ctx.moveTo(g.x(i), g.y(r)); ctx.lineTo(g.x(i + 1), g.y(r)); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < n; i++) {
      const p = P[i];
      if (p.t <= 0) continue;
      const path = pathOf(i, g);
      strokePartial(path, p.t, bg, 9);
      const h = strokePartial(path, p.t, COLORS[i], 5);
      if (p.run) {
        ctx.beginPath(); ctx.arc(h[0], h[1], 7, 0, Math.PI * 2);
        ctx.fillStyle = COLORS[i]; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = bg; ctx.stroke();
      }
    }
  }

  /* ---------------- おと ---------------- */
  let AC = null;
  function ac() {
    if (!S.sound) return null;
    try {
      if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
    } catch (e) { return null; }
    return AC;
  }
  function tone(f, delay, dur, vol) {
    const a = ac();
    if (!a) return;
    try {
      const o = a.createOscillator(), gn = a.createGain(), t = a.currentTime + delay;
      o.type = 'triangle';
      o.frequency.value = f;
      gn.gain.setValueAtTime(0, t);
      gn.gain.linearRampToValueAtTime(vol, t + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(gn); gn.connect(a.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* 鳴らなくても遊べる */ }
  }

  /* ---------------- あそぶ画面 ---------------- */
  /** 字を 1 字ずつ箱に入れる (縦に積むため)。絵文字の合成も 1 字として扱う */
  function chars(text) {
    const list = window.Intl && Intl.Segmenter
      ? [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
      : Array.from(text);
    // 2 桁までの数字は 1 つの箱にまとめる (縦中横)。「10」が「1」「0」に割れないように
    const out = [];
    for (const ch of list) {
      const last = out[out.length - 1];
      if (/^[0-9]$/.test(ch) && last && /^[0-9]$/.test(last)) out[out.length - 1] = last + ch;
      else out.push(ch);
    }
    return out;
  }
  function setLabel(el, text, vertical) {
    el.textContent = '';
    if (!vertical) { el.textContent = text; return; }
    const box = document.createElement('span');
    box.className = 'tate';
    for (const ch of chars(text)) {
      const s = document.createElement('span');
      s.textContent = ch;
      box.appendChild(s);
    }
    el.appendChild(box);
  }
  const nameOf = (i) => S.names[i] || String(i + 1);
  const vertical = () => G.ladder.n >= VERT_FROM;

  function buildPlay() {
    cancelAnimationFrame(raf);
    raf = 0;
    fit();
    newGame();
    const n = G.ladder.n;
    const wrap = $('#wrap');
    wrap.className = vertical() ? 'vert' : '';
    const names = $('#names'), slots = $('#slots');
    names.style.setProperty('--n', n);
    slots.style.setProperty('--n', n);
    names.textContent = '';
    slots.textContent = '';
    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nmb';
      b.style.setProperty('--c', COLORS[i]);
      b.setAttribute('aria-label', nameOf(i));
      setLabel(b, nameOf(i), vertical());
      b.addEventListener('click', () => startOne(i, 0));
      names.appendChild(b);
      const s = document.createElement('div');
      s.className = 'slot';
      setLabel(s, '？', false);
      slots.appendChild(s);
    }
    $('#sum').textContent = '';
    $('#hint').hidden = false;
    $('#all').disabled = false;
    updateBar();
    sizeCanvas();
    draw();
  }

  function updateBar() {
    $('#snd').textContent = S.sound ? 'おと あり' : 'おと なし';
    $('#rung').textContent = S.hide ? 'よこ線をみせる' : 'よこ線をかくす';
  }

  function startOne(i, delay) {
    const p = P[i];
    if (!p || p.run || p.done) return;
    ac();
    p.run = true;
    p.t = 0.001;
    p.ticked = 0;
    p.startAt = performance.now() + delay;
    p.prev = p.startAt;
    $('#hint').hidden = true;
    $('#names').children[i].disabled = true;
    kick();
  }

  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function frame(ts) {
    raf = 0;
    if (!G) return;
    const g = geom();
    let busy = false;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (!p.run) continue;
      busy = true;
      if (ts < p.startAt) continue;
      // コマの間隔は上も下も止める (負の間隔で逆走させない・止まった後に飛ばさない)
      const dt = Math.min(0.05, Math.max(0, (ts - p.prev) / 1000));
      p.prev = ts;
      p.t += speed * dt;
      const path = pathOf(i, g);
      while (p.ticked < path.hs.length && p.t >= path.hs[p.ticked]) {
        tone(560 + p.ticked * 18, 0, 0.07, 0.07);
        p.ticked++;
      }
      if (p.t >= path.total) {
        p.t = path.total;
        p.run = false;
        p.done = true;
        finish(i, path.end);
      }
    }
    draw();
    if (busy) kick();
  }

  function finish(i, end) {
    const txt = G.slot[end];
    const slot = $('#slots').children[end];
    slot.style.setProperty('--c', COLORS[i]);
    slot.classList.add('open');
    const hit = C.isHit(txt);
    slot.classList.toggle('hit', hit);
    setLabel(slot, txt || '—', vertical());
    $('#names').children[i].classList.add('done');
    if (hit) [660, 880, 1100, 1320].forEach((f, k) => tone(f, k * 0.08, 0.3, 0.1));
    else tone(440, 0, 0.22, 0.09);
    renderSum();
    if (P.every((q) => q.done)) $('#all').disabled = true;
  }

  function renderSum() {
    const ul = $('#sum');
    ul.textContent = '';
    for (let i = 0; i < P.length; i++) {
      if (!P[i].done) continue;
      const li = document.createElement('li');
      const dot = document.createElement('i');
      dot.style.background = COLORS[i];
      const b = document.createElement('b');
      b.textContent = nameOf(i);
      const s = document.createElement('span');
      s.textContent = G.slot[G.paths[i].end] || '—';
      li.append(dot, b, s);
      ul.appendChild(li);
    }
  }

  /* ---------------- 操作 ---------------- */
  function main() {
    $('#minus').addEventListener('click', () => {
      if (S.n > C.MIN_N) { S.n--; save(); renderSetup(); }
    });
    $('#plus').addEventListener('click', () => {
      if (S.n < C.MAX_N) { S.n++; save(); renderSetup(); }
    });
    document.querySelectorAll('.presets button').forEach((b) => {
      b.addEventListener('click', () => {
        S.results = C.presetResults(b.dataset.p, S.n);
        save();
        renderSetup();
      });
    });
    $('#go').addEventListener('click', () => {
      saveNow();
      $('#setup').hidden = true;
      $('#play').hidden = false;
      buildPlay();
      window.scrollTo(0, 0);
    });
    $('#back').addEventListener('click', () => {
      cancelAnimationFrame(raf);
      raf = 0;
      $('#play').hidden = true;
      $('#setup').hidden = false;
      renderSetup();
    });
    $('#again').addEventListener('click', buildPlay);
    $('#all').addEventListener('click', () => {
      let k = 0;
      for (let i = 0; i < P.length; i++) {
        if (!P[i].run && !P[i].done) { startOne(i, k * 160); k++; }
      }
    });
    $('#rung').addEventListener('click', () => { S.hide = !S.hide; save(); updateBar(); draw(); });
    $('#snd').addEventListener('click', () => {
      S.sound = !S.sound;
      save();
      updateBar();
      if (S.sound) tone(660, 0, 0.12, 0.08);
    });

    const redraw = () => { if (!$('#play').hidden) { sizeCanvas(); draw(); } };
    if (window.ResizeObserver) new ResizeObserver(redraw).observe(cv);
    else window.addEventListener('resize', redraw);
    try { window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', draw); } catch (e) { /* 古いブラウザ */ }

    renderSetup();

    // 自動テストから中身をのぞくための入口
    window.__app = {
      settings: () => S,
      game: () => G,
      players: () => P,
      setSpeed: (v) => { speed = v; },
      saveNow: saveNow
    };
  }

  main();
})();
