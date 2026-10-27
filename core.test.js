const test = require('node:test');
const assert = require('node:assert');
const Core = require('./core.js');

test('同じ seed からは同じ数が出る', () => {
  const a = Core.mulberry32(42);
  const b = Core.mulberry32(42);
  for (let i = 0; i < 10; i++) assert.strictEqual(a(), b());
});

test('shuffle は中身を減らさない', () => {
  const source = [1, 2, 3, 4, 5, 6, 7, 8];
  const mixed = Core.shuffle(source.slice(), Core.mulberry32(7));
  assert.deepStrictEqual(mixed.slice().sort((x, y) => x - y), source);
});

test('clampN は 2〜12 に収める', () => {
  assert.strictEqual(Core.clampN(1), 2);
  assert.strictEqual(Core.clampN(13), 12);
  assert.strictEqual(Core.clampN('5'), 5);
  assert.strictEqual(Core.clampN('x'), 6);
});

// 人数 2〜12 と seed 500 通り = 5500 本のはしごで、作りの約束を確かめる
function eachLadder(fn) {
  for (let n = Core.MIN_N; n <= Core.MAX_N; n++) {
    for (let seed = 0; seed < 500; seed++) fn(Core.makeLadder(n, Core.mulberry32(seed * 977 + n)), n, seed);
  }
}

test('行き先は必ず 1 人 1 か所 (重なりも余りも無い)', () => {
  eachLadder((l, n, seed) => {
    const d = Core.destinations(l);
    assert.deepStrictEqual(d.slice().sort((a, b) => a - b), [...Array(n).keys()], `n=${n} seed=${seed}`);
  });
});

test('同じ段で横線が隣り合わない', () => {
  eachLadder((l, n, seed) => {
    for (const row of l.rows) {
      assert.strictEqual(row.length, n - 1);
      for (let g = 1; g < row.length; g++) assert.ok(!(row[g] && row[g - 1]), `n=${n} seed=${seed}`);
    }
  });
});

test('どの隙間にも横線が 2 本以上ある', () => {
  eachLadder((l, n, seed) => {
    for (let g = 0; g < n - 1; g++) {
      const count = l.rows.filter((row) => row[g]).length;
      assert.ok(count >= Core.MIN_RUNGS_PER_GAP, `n=${n} seed=${seed} gap=${g} count=${count}`);
    }
  });
});

test('横線を引く余地が無い乱数でも、段を足して約束を守る', () => {
  // 乱数が常に 0 → 最初の詰め込みで 0,2,4… の隙間が全段ふさがり、奇数の隙間は置けない
  const l = Core.makeLadder(6, () => 0);
  for (let g = 0; g < 5; g++) assert.ok(l.rows.filter((row) => row[g]).length >= 2, `gap=${g}`);
  const d = Core.destinations(l);
  assert.deepStrictEqual(d.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);
});

test('trace の曲がり角は、その段の横線と一致する', () => {
  const l = Core.makeLadder(8, Core.mulberry32(3));
  for (let i = 0; i < 8; i++) {
    const t = Core.trace(l, i);
    let c = i;
    for (const turn of t.turns) {
      assert.strictEqual(turn.from, c);
      assert.strictEqual(Math.abs(turn.to - turn.from), 1);
      assert.ok(l.rows[turn.row][Math.min(turn.from, turn.to)]);
      c = turn.to;
    }
    assert.strictEqual(c, t.end);
  }
});

test('同じ seed なら同じはしご', () => {
  assert.deepStrictEqual(Core.makeLadder(7, Core.mulberry32(9)), Core.makeLadder(7, Core.mulberry32(9)));
});

test('ひな形と、数あわせ', () => {
  assert.deepStrictEqual(Core.presetResults('one', 3), ['あたり', 'はずれ', 'はずれ']);
  assert.deepStrictEqual(Core.presetResults('order', 3), ['1', '2', '3']);
  assert.deepStrictEqual(Core.presetResults('blank', 2), ['', '']);
  const f = Core.fitLists(['太郎'], [], 3);
  assert.deepStrictEqual(f.names, ['太郎', 'B', 'C']);
  assert.deepStrictEqual(f.results, ['あたり', 'はずれ', 'はずれ']);
  assert.strictEqual(Core.fitLists(['a', 'b', 'c'], ['1', '2', '3'], 2).names.length, 2);
  assert.ok(Core.isHit(' あたり '));
  assert.ok(!Core.isHit('はずれ'));
});
