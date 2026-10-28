'use strict';

// 만칼라 규칙·컴퓨터 시험. 실행: npm test (node --test)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

// 고정 난수 (확률이 걸린 시험은 항상 같은 결과가 나오게)
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const total = (g) => g.board.reduce((a, b) => a + b, 0);
// 판을 직접 꾸민다: pits0 = 첫 번째 사람 구덩이 6개, pits1 = 두 번째 사람 구덩이 6개(7~12 번 순서)
function setup(pits0, pits1, turn = 0, s0 = 0, s1 = 0) {
  const g = L.newGame();
  g.board = [...pits0, s0, ...pits1, s1];
  g.turn = turn;
  return g;
}

test('new game has 4 seeds in each of the 12 pits and empty stores', () => {
  const g = L.newGame();
  assert.strictEqual(g.board.length, 14);
  assert.strictEqual(total(g), 48);
  assert.deepStrictEqual(g.board, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.strictEqual(g.turn, 0);
  assert.deepStrictEqual(L.legalPits(g), [0, 1, 2, 3, 4, 5]);
});

test('sowing drops one seed per pit counter-clockwise and passes the turn', () => {
  const g = L.newGame();
  const ev = L.apply(g, { type: 'sow', pit: 0 });
  assert.deepStrictEqual(ev.path, [1, 2, 3, 4]);
  assert.deepStrictEqual(g.board, [0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.strictEqual(ev.extra, false);
  assert.strictEqual(g.turn, 1);
});

test('last seed in your own store gives another turn', () => {
  const g = L.newGame();
  const ev = L.apply(g, { type: 'sow', pit: 2 });          // 4개를 뿌리면 3,4,5 와 창고
  assert.deepStrictEqual(ev.path, [3, 4, 5, 6]);
  assert.strictEqual(ev.extra, true);
  assert.strictEqual(g.turn, 0, 'same player moves again');
  assert.strictEqual(g.board[6], 1);
});

test('the opponent store is skipped when sowing around', () => {
  const g = setup([0, 2, 0, 0, 0, 9], [1, 1, 1, 1, 1, 1], 0);   // 아홉 개: 6, 7~12, (13 건너뜀), 0
  const ev = L.apply(g, { type: 'sow', pit: 5 });
  assert.deepStrictEqual(ev.path, [6, 7, 8, 9, 10, 11, 12, 0, 1]);
  assert.strictEqual(g.board[13], 0, 'opponent store untouched');
  assert.strictEqual(g.board[6], 1);
  const h = setup([1, 1, 1, 1, 1, 1], [0, 2, 0, 0, 0, 9], 1);   // 두 번째 사람도 첫 번째 사람 창고(6)를 건너뛴다
  const ev2 = L.apply(h, { type: 'sow', pit: 5 });
  assert.deepStrictEqual(ev2.path, [13, 0, 1, 2, 3, 4, 5, 7, 8]);
  assert.strictEqual(h.board[6], 0);
  assert.strictEqual(h.board[13], 1);
});

test('landing in your own empty pit captures the opposite seeds', () => {
  const g = setup([1, 0, 3, 3, 3, 3], [4, 4, 4, 4, 5, 4], 0);   // 0 번 구덩이의 콩 1개가 빈 1 번에 떨어짐, 맞은편은 12-1=11 (두 번째 사람의 4 번째 구덩이)
  const ev = L.apply(g, { type: 'sow', pit: 0 });
  assert.deepStrictEqual(ev.capture, { pit: 1, opp: 11, n: 6 });
  assert.strictEqual(g.board[6], 6);
  assert.strictEqual(g.board[1], 0);
  assert.strictEqual(g.board[11], 0);
  assert.strictEqual(g.turn, 1);
});

test('no capture when the opposite pit is empty or the empty pit is on the other side', () => {
  const a = setup([1, 0, 3, 3, 3, 3], [4, 4, 4, 4, 0, 4], 0);   // 맞은편(11)이 비어 있음
  const ev = L.apply(a, { type: 'sow', pit: 0 });
  assert.strictEqual(ev.capture, null);
  assert.strictEqual(a.board[1], 1);
  assert.strictEqual(a.board[6], 0);
  const b = setup([1, 0, 0, 0, 0, 2], [0, 4, 4, 4, 4, 4], 0);   // 마지막 콩이 상대 쪽 빈 구덩이(7)에 떨어짐: 뺏지 못한다
  const ev2 = L.apply(b, { type: 'sow', pit: 5 });
  assert.strictEqual(ev2.last, 7);
  assert.strictEqual(ev2.capture, null);
  assert.strictEqual(b.board[7], 1);
});

test('the second player captures with the same rules', () => {
  const g = setup([4, 4, 4, 6, 4, 4], [1, 0, 3, 3, 3, 3], 1);   // 두 번째 사람: 7 번의 콩 1개가 빈 8 번에 떨어짐, 맞은편은 12-8=4
  const ev = L.apply(g, { type: 'sow', pit: 0 });
  assert.deepStrictEqual(ev.capture, { pit: 8, opp: 4, n: 5 });
  assert.strictEqual(g.board[13], 5);
  assert.strictEqual(g.turn, 0);
});

test('sowing 13 seeds laps the board and lands back in the emptied pit', () => {
  const g = setup([13, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1], 0);
  const before = total(g);
  const ev = L.apply(g, { type: 'sow', pit: 0 });
  assert.strictEqual(ev.path.length, 13);
  assert.strictEqual(ev.last, 0);
  assert.strictEqual(total(g), before, 'no seeds appear or vanish');
  assert.strictEqual(g.board[13], 0);
});

test('when one side runs out the rest go to its owner and the larger store wins', () => {
  const g = setup([0, 0, 0, 0, 0, 1], [3, 0, 0, 0, 0, 2], 0, 20, 22);   // 마지막 콩이 창고로 들어가며 내 줄이 빔
  const ev = L.apply(g, { type: 'sow', pit: 5 });
  assert.strictEqual(ev.over, true);
  assert.strictEqual(ev.swept, true);
  assert.strictEqual(g.board[6], 21);
  assert.strictEqual(g.board[13], 27);                    // 22 + 남은 5
  assert.strictEqual(g.winner, 1);
  assert.strictEqual(g.reason, 'empty');
  assert.strictEqual(total(g), 48);
  assert.ok(g.board.every((v, i) => L.isStore(i) || v === 0));
  assert.strictEqual(L.apply(g, { type: 'sow', pit: 0 }), null, 'nothing after the end');
  assert.deepStrictEqual(L.legalPits(g), []);
});

test('a tied final count is a draw', () => {
  const g = setup([0, 0, 0, 0, 0, 1], [2, 0, 0, 0, 0, 0], 0, 23, 22);
  L.apply(g, { type: 'sow', pit: 5 });
  assert.strictEqual(g.board[6], 24);
  assert.strictEqual(g.board[13], 24);
  assert.strictEqual(g.winner, 2);
});

test('more than half of the seeds in a store ends the game at once', () => {
  const g = setup([0, 0, 0, 0, 2, 1], [3, 3, 3, 3, 3, 3], 0, 24, 3);
  const ev = L.apply(g, { type: 'sow', pit: 5 });
  assert.strictEqual(ev.over, true);
  assert.strictEqual(g.reason, 'majority');
  assert.strictEqual(g.winner, 0);
  assert.strictEqual(g.board[6], 25);
});

test('illegal actions are refused and change nothing', () => {
  const g = setup([0, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4], 0);
  const snap = JSON.stringify(g);
  for (const bad of [{ type: 'sow', pit: 0 }, { type: 'sow', pit: -1 }, { type: 'sow', pit: 6 }, { type: 'sow', pit: 1.5 }, { type: 'sow', pit: '1' }, { type: 'sow' }, { type: 'move', pit: 1 }, {}, null, undefined, 3]) {
    assert.strictEqual(L.apply(g, bad), null);
  }
  assert.strictEqual(JSON.stringify(g), snap);
  assert.deepStrictEqual(L.legalPits(g), [1, 2, 3, 4, 5]);
});

test('random games keep all 48 seeds, always end and stay in range', () => {
  const rng = seeded(2026);
  for (let k = 0; k < 120; k++) {
    const g = L.newGame();
    let guard = 0;
    while (!g.over && guard++ < 1000) {
      const moves = L.legalPits(g);
      assert.ok(moves.length > 0, 'the mover always has a pit while the game is on');
      L.apply(g, { type: 'sow', pit: moves[Math.floor(rng() * moves.length)] });
      assert.strictEqual(total(g), 48);
      assert.ok(g.board.every((v) => v >= 0));
    }
    assert.ok(g.over, 'every game ends');
    assert.ok(g.winner >= 0 && g.winner <= 2);
  }
});

test('computer picks only legal pits', () => {
  const rng = seeded(3);
  for (const level of ['easy', 'hard']) {
    for (let k = 0; k < 20; k++) {
      const g = L.newGame();
      for (let i = 0; i < Math.floor(rng() * 25) && !g.over; i++) { const m = L.legalPits(g); L.apply(g, { type: 'sow', pit: m[Math.floor(rng() * m.length)] }); }
      if (g.over) continue;
      const a = L.aiPick(g, level, rng);
      assert.ok(L.legalPits(g).includes(a.pit), `${level}`);
    }
  }
  assert.strictEqual(L.aiPick(setup([0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1], 0), 'hard'), null, 'no move, no pick');
});

test('hard computer takes the extra turn and the capture when they are there', () => {
  const noSlip = () => 0.99;
  const extra = L.newGame();                                 // 처음 판에서는 2 번 구덩이(한 번 더)가 가장 좋은 첫 수 중 하나
  assert.strictEqual(L.aiPick(extra, 'hard', noSlip).pit, 2);
  const cap = setup([1, 0, 5, 5, 5, 0], [2, 2, 2, 2, 9, 2], 0);   // 0 번을 두면 맞은편 9개를 가져온다 (다른 수는 한 번 더도 가져오기도 없다)
  assert.strictEqual(L.aiPick(cap, 'hard', noSlip).pit, 0);
});

test('hard computer beats easy in most seeded games (both seats)', () => {
  const rng = seeded(31337);
  let hardWins = 0, games = 20;
  for (let k = 0; k < games; k++) {
    const g = L.newGame();
    const hardSide = k % 2;
    let guard = 0;
    while (!g.over && guard++ < 1000) assert.ok(L.apply(g, L.aiPick(g, g.turn === hardSide ? 'hard' : 'easy', rng)));
    if (g.winner === hardSide) hardWins++;
  }
  assert.ok(hardWins >= 16, `hard won ${hardWins}/${games}`);
});
