/*!
 * core.js — あみだくじのロジック。DOM を触らないので node でテストできる。
 *
 * ブラウザでは <script> で読み込むと window.Core になり、
 * node からは require() できる。
 *
 * あみだくじは「隣どうしを入れ替える」の積み重ねなので、横線をどう引いても
 * 行き先は必ず 1 人 1 か所 (重なりも余りも出ない)。ここではそれを崩さないよう、
 * 同じ段で横線が隣り合わない (1 本の縦線から左右へ同時に出ない) ことだけ守る。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIN_N = 2;
  const MAX_N = 12;
  const MIN_RUNGS_PER_GAP = 2;

  /**
   * 決まった順番で数を出す乱数 (mulberry32)。
   * 同じ seed からは必ず同じ並びになるので、
   * 「同じ状態を作り直せる」「テストで結果を固定できる」。
   */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 配列をその場で混ぜる。rng を渡せば結果を再現できる。 */
  function shuffle(array, rng) {
    const random = rng || Math.random;
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      const t = array[i];
      array[i] = array[j];
      array[j] = t;
    }
    return array;
  }

  function clampN(n) {
    n = Math.round(Number(n));
    if (!Number.isFinite(n)) return 6;
    return Math.min(MAX_N, Math.max(MIN_N, n));
  }

  /** その段の gap 番目 (縦線 gap と gap+1 の間) に横線を引けるか */
  function canPlace(row, gap) {
    return !row[gap] && !(gap > 0 && row[gap - 1]) && !(gap < row.length - 1 && row[gap + 1]);
  }

  /**
   * はしごを作る。rows[段][gap] が true ならそこに横線がある。
   * どの隙間にも横線が MIN_RUNGS_PER_GAP 本以上あることを、作りで保証する
   * (足りなければ空いている段に足し、どの段も空いていなければ段を足す)。
   */
  function makeLadder(n, rng) {
    n = clampN(n);
    const random = rng || Math.random;
    const R = 10 + n;
    const rows = [];
    for (let r = 0; r < R; r++) {
      const row = [];
      for (let g = 0; g < n - 1; g++) row.push(false);
      for (let g = 0; g < n - 1; g++) {
        if (random() < 0.45 && canPlace(row, g)) row[g] = true;
      }
      rows.push(row);
    }
    for (let g = 0; g < n - 1; g++) {
      let count = rows.filter((row) => row[g]).length;
      while (count < MIN_RUNGS_PER_GAP) {
        const free = [];
        for (let r = 0; r < rows.length; r++) if (canPlace(rows[r], g)) free.push(r);
        if (free.length) {
          rows[free[Math.floor(random() * free.length)]][g] = true;
        } else {
          const row = new Array(n - 1).fill(false);
          row[g] = true;
          rows.splice(Math.floor(random() * (rows.length + 1)), 0, row);
        }
        count++;
      }
    }
    return { n: n, rows: rows };
  }

  /**
   * start 番目の縦線からたどる。
   * turns は横へ渡った所 ({ row, from, to }) の並び、end は着いた縦線。
   */
  function trace(ladder, start) {
    let c = start;
    const turns = [];
    for (let r = 0; r < ladder.rows.length; r++) {
      const row = ladder.rows[r];
      let next = c;
      if (c > 0 && row[c - 1]) next = c - 1;
      else if (c < ladder.n - 1 && row[c]) next = c + 1;
      if (next !== c) {
        turns.push({ row: r, from: c, to: next });
        c = next;
      }
    }
    return { start: start, end: c, turns: turns };
  }

  /** 全員の行き先。destinations(l)[i] が i 番目の人の着く縦線 */
  function destinations(ladder) {
    const out = [];
    for (let i = 0; i < ladder.n; i++) out.push(trace(ladder, i).end);
    return out;
  }

  function defaultName(i) {
    return String.fromCharCode(65 + i);
  }

  /** 結果のひな形。one: あたり1つ / order: 1,2,3… / blank: 空 */
  function presetResults(kind, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push(kind === 'one' ? (i === 0 ? 'あたり' : 'はずれ') : kind === 'order' ? String(i + 1) : '');
    }
    return out;
  }

  /** 名前と結果の数を n に合わせる。足りない所はひな形で埋める */
  function fitLists(names, results, n) {
    names = names.slice(0, n);
    results = results.slice(0, n);
    for (let i = 0; i < n; i++) {
      if (names[i] == null) names[i] = defaultName(i);
      if (results[i] == null) results[i] = i === 0 ? 'あたり' : 'はずれ';
    }
    return { names: names, results: results };
  }

  function isHit(text) {
    return String(text).trim() === 'あたり';
  }

  return {
    MIN_N: MIN_N,
    MAX_N: MAX_N,
    MIN_RUNGS_PER_GAP: MIN_RUNGS_PER_GAP,
    mulberry32: mulberry32,
    shuffle: shuffle,
    clampN: clampN,
    makeLadder: makeLadder,
    trace: trace,
    destinations: destinations,
    defaultName: defaultName,
    presetResults: presetResults,
    fitLists: fitLists,
    isHit: isHit
  };
});
