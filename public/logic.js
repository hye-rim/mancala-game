'use strict';
// 만칼라(칼라 규칙): 규칙과 컴퓨터. 화면 없이 Node 에서 시험한다 (브라우저에서는 전역 LOGIC_MANCALA).
// 칸 번호 0~13: 0~5 는 첫 번째 사람(아래)의 구덩이, 6 은 그 사람 창고(오른쪽), 7~12 는 두 번째 사람(위)의 구덩이, 13 은 그 사람 창고(왼쪽).
// 콩은 번호가 커지는 방향(시계 반대 방향)으로 한 칸에 하나씩 뿌리고, 상대 창고는 건너뛴다.
const LOGIC_MANCALA = (() => {
  const PITS = 6, SEEDS = 4, TOTAL = PITS * 2 * SEEDS;   // 구덩이 6개 x 콩 4개 x 2줄 = 48
  const MAX_PLIES = 400;                                  // 끝없이 도는 판을 막는 안전장치
  const HARD_SLIP = 0.2;                                  // 어려움도 다섯 번에 한 번쯤은 쉬움처럼 둔다 (사람이 이길 수 있게)
  const DEPTH = { easy: 1, hard: 8 };

  const storeOf = (p) => p * 7 + 6;
  const pitIndex = (p, k) => p * 7 + k;
  const ownerOf = (i) => (i < 7 ? 0 : 1);
  const isStore = (i) => i === 6 || i === 13;
  const opposite = (i) => 12 - i;

  function newGame() {
    const board = [];
    for (let i = 0; i < 14; i++) board.push(isStore(i) ? 0 : SEEDS);
    return { board, turn: 0, plies: 0, over: false, winner: -1, reason: '' };
  }
  const clone = (g) => ({ board: g.board.slice(), turn: g.turn, plies: g.plies, over: g.over, winner: g.winner, reason: g.reason });

  // 지금 둘 수 있는 구덩이 번호(0~5): 콩이 들어 있는 내 구덩이
  function legalPits(g) {
    const out = [];
    if (g.over) return out;
    for (let k = 0; k < PITS; k++) if (g.board[pitIndex(g.turn, k)] > 0) out.push(k);
    return out;
  }
  const sideSum = (board, p) => { let s = 0; for (let k = 0; k < PITS; k++) s += board[pitIndex(p, k)]; return s; };
  function finish(g, reason) {
    g.over = true; g.reason = reason;
    const a = g.board[6], b = g.board[13];
    g.winner = a === b ? 2 : (a > b ? 0 : 1);
  }

  // 한 동작을 둔다. { type:'sow', pit: 0~5 }. 규칙에 맞지 않으면 null
  function apply(g, a) {
    if (!a || g.over || a.type !== 'sow' || !Number.isInteger(a.pit) || a.pit < 0 || a.pit >= PITS) return null;
    const who = g.turn, from = pitIndex(who, a.pit), b = g.board;
    if (b[from] <= 0) return null;
    let n = b[from], i = from;
    b[from] = 0;
    const path = [];
    while (n > 0) {
      i = (i + 1) % 14;
      if (i === storeOf(1 - who)) continue;               // 상대 창고는 건너뛴다
      b[i]++; n--; path.push(i);
    }
    const last = i;
    const extra = last === storeOf(who);
    let capture = null;
    // 마지막 콩이 내 쪽 빈 구덩이에 떨어졌고 맞은편에 콩이 있으면 그 콩과 내 콩 1개를 창고로 가져온다
    if (!extra && ownerOf(last) === who && !isStore(last) && b[last] === 1 && b[opposite(last)] > 0) {
      const opp = opposite(last), got = b[opp] + 1;
      b[storeOf(who)] += got; b[opp] = 0; b[last] = 0;
      capture = { pit: last, opp, n: got };
    }
    g.plies++;
    let swept = false;
    if (sideSum(b, 0) === 0 || sideSum(b, 1) === 0) {      // 한쪽 줄이 비면 끝: 남은 콩은 그 줄 주인의 창고로
      for (let p = 0; p < 2; p++) for (let k = 0; k < PITS; k++) { b[storeOf(p)] += b[pitIndex(p, k)]; b[pitIndex(p, k)] = 0; }
      swept = true;
      finish(g, 'empty');
    } else if (b[6] > TOTAL / 2 || b[13] > TOTAL / 2) finish(g, 'majority');
    else if (g.plies >= MAX_PLIES) finish(g, 'limit');
    if (!g.over && !extra) g.turn = 1 - who;
    return { who, type: 'sow', pit: a.pit, from, path, last, extra: extra && !g.over, capture, swept, over: g.over, winner: g.winner };
  }

  // ---------- 컴퓨터 ----------
  const evaluate = (g, me) => {
    if (g.over) return (g.board[storeOf(me)] - g.board[storeOf(1 - me)]) * 100 + (g.winner === me ? 10000 : g.winner === 2 ? 0 : -10000);
    return (g.board[storeOf(me)] - g.board[storeOf(1 - me)]) * 10 + (sideSum(g.board, me) - sideSum(g.board, 1 - me));
  };
  // 한 번 더 두는 수와 가져오는 수를 먼저 보게 줄을 세운다 (가지치기가 잘 되도록)
  function ordered(g) {
    const moves = legalPits(g).map((k) => {
      const c = clone(g), ev = apply(c, { type: 'sow', pit: k });
      return { k, key: (ev.extra ? 100 : 0) + (ev.capture ? ev.capture.n * 2 : 0) + c.board[storeOf(g.turn)] };
    });
    return moves.sort((x, y) => y.key - x.key).map((m) => m.k);
  }
  function search(g, depth, alpha, beta, me) {
    if (g.over || depth === 0) return evaluate(g, me);
    const maximizing = g.turn === me;
    let best = maximizing ? -Infinity : Infinity;
    for (const k of ordered(g)) {
      const c = clone(g);
      apply(c, { type: 'sow', pit: k });
      const v = search(c, depth - 1, alpha, beta, me);
      if (maximizing) { if (v > best) best = v; if (best > alpha) alpha = best; }
      else { if (v < best) best = v; if (best < beta) beta = best; }
      if (beta <= alpha) break;
    }
    return best;
  }
  function aiPick(g, level = 'easy', rng = Math.random) {
    const moves = legalPits(g);
    if (!moves.length) return null;
    const me = g.turn;
    const greedy = () => {                                // 한 수 앞만: 창고에 넣는 콩이 가장 많이 느는 수 (한 번 더는 덤)
      let best = [], bestV = -Infinity;
      for (const k of moves) {
        const c = clone(g), before = c.board[storeOf(me)], ev = apply(c, { type: 'sow', pit: k });
        const v = c.board[storeOf(me)] - before + (ev.extra ? 1.5 : 0);
        if (v > bestV) { bestV = v; best = [k]; } else if (v === bestV) best.push(k);
      }
      return best[Math.floor(rng() * best.length)];
    };
    if (level !== 'hard') return { type: 'sow', pit: rng() < 0.35 ? moves[Math.floor(rng() * moves.length)] : greedy() };
    if (rng() < HARD_SLIP) return { type: 'sow', pit: rng() < 0.5 ? greedy() : moves[Math.floor(rng() * moves.length)] };
    let bestK = moves[0], bestV = -Infinity;
    for (const k of ordered(g)) {
      const c = clone(g);
      apply(c, { type: 'sow', pit: k });
      const v = search(c, DEPTH.hard - 1, -Infinity, Infinity, me);
      if (v > bestV) { bestV = v; bestK = k; }
    }
    return { type: 'sow', pit: bestK };
  }

  return { PITS, SEEDS, TOTAL, MAX_PLIES, HARD_SLIP, DEPTH, storeOf, pitIndex, ownerOf, isStore, opposite, newGame, legalPits, apply, aiPick, sideSum };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_MANCALA;
