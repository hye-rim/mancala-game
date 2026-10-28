'use strict';

// 서버 시험: 보안·안정성 회귀 + 만칼라 온라인 대국 흐름
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const L = require('../public/logic.js');

// 운영체제가 지금 비어 있는 포트를 골라 준다 (고정 포트·범위 난수는 다른 서버와 겹쳐 가끔 실패한다)
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TURN_MS: '2500' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };

// 두 손님을 빠른 대전으로 맺어 준다
async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'both players enter a playing room');
  return [a, b];
}
const mover = (a, b) => (a.room.turn === a.room.you ? a : b);
const closeAll = (...cs) => cs.forEach((c) => c.ws.close());
const act = (c, action) => send(c, 'act', { action });
const stamp = (room) => JSON.stringify([room.board, room.turn, room.plies]);


test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/logic.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match starts with 4 seeds everywhere and only the mover gets the legal pits', async () => {
  await ready;
  const [a, b] = await pair();
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.strictEqual(a.room.turn, 0);
  assert.deepStrictEqual(a.room.board, L.newGame().board);
  assert.deepStrictEqual(a.room.board, b.room.board);
  const first = mover(a, b), second = first === a ? b : a;
  assert.strictEqual(first.room.you, 0, 'the first mover is the bottom row');
  assert.deepStrictEqual(first.room.legal, [0, 1, 2, 3, 4, 5]);
  assert.deepStrictEqual(second.room.legal, []);
  closeAll(a, b);
});

test('out-of-turn and garbage actions are ignored', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  const before = stamp(a.room);
  act(second, { type: 'sow', pit: 0 });                             // 내 차례가 아님
  const junk = [{}, { type: 'sow' }, { type: 'sow', pit: 'a' }, { type: 'sow', pit: 1.5 }, { type: 'sow', pit: -1 }, { type: 'sow', pit: 6 },
    { type: 'sow', pit: 1e9 }, { type: ['sow'] }, { type: null }, { type: 'move', from: 1, to: 2 }, [], 'sow', 5, null];
  for (const action of junk) act(first, action);
  send(first, 'act');
  send(first, 'act', { action: 'x' });
  await sleep(300);
  assert.strictEqual(stamp(a.room), before, 'nothing happened');
  assert.strictEqual(a.room.turn, 0);
  assert.strictEqual(await get('/'), 200, 'the server survived');
  closeAll(a, b);
});

test('a sow updates both boards, passes the turn and reports the path', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  act(first, { type: 'sow', pit: 0 });
  assert.ok(await until(() => a.room.turn === 1 && b.room.turn === 1));
  assert.deepStrictEqual(a.room.board, [0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.deepStrictEqual(a.room.board, b.room.board);
  assert.deepStrictEqual({ who: a.room.lastMove.who, pit: a.room.lastMove.pit, path: a.room.lastMove.path, extra: a.room.lastMove.extra, seq: a.room.lastMove.seq }, { who: 0, pit: 0, path: [1, 2, 3, 4], extra: false, seq: 1 });
  assert.deepStrictEqual(second.room.legal, [0, 1, 2, 3, 4, 5]);
  assert.deepStrictEqual(first.room.legal, []);
  act(first, { type: 'sow', pit: 1 });                              // 이제 상대 차례
  await sleep(200);
  assert.strictEqual(a.room.turn, 1);
  closeAll(a, b);
});

test('landing in your store keeps the turn with the same player', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b);
  act(first, { type: 'sow', pit: 2 });
  assert.ok(await until(() => first.room.lastMove && first.room.lastMove.seq === 1 && first.room.legal.length > 0));
  assert.strictEqual(first.room.turn, first.room.you, 'extra turn');
  assert.strictEqual(first.room.lastMove.extra, true);
  assert.strictEqual(first.room.board[6], 1);
  closeAll(a, b);
});

test('an empty pit is refused and the sender is told', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b);
  act(first, { type: 'sow', pit: 2 });                              // 2 번이 비었고 한 번 더
  assert.ok(await until(() => first.room.board[2] === 0 && first.room.legal.length > 0));
  const before = stamp(a.room);
  act(first, { type: 'sow', pit: 2 });
  await sleep(300);
  assert.strictEqual(stamp(a.room), before);
  assert.ok(first.msgs.some((m) => m.t === 'rejected'));
  closeAll(a, b);
});

test('two players play random pits to the end and stay in sync', async () => {
  await ready;
  const [a, b] = await pair();
  for (let i = 0; i < 300 && a.room.state === 'playing'; i++) {
    const m = mover(a, b);
    const before = stamp(m.room);
    const legal = m.room.legal;
    act(m, { type: 'sow', pit: legal[Math.floor(Math.random() * legal.length)] });
    await until(() => a.room.state === 'over' || (stamp(a.room) !== before && stamp(b.room) === stamp(a.room)), 3000);
    assert.deepStrictEqual(a.room.board, b.room.board);
    assert.strictEqual(a.room.board.reduce((x, y) => x + y, 0), 48);
  }
  assert.strictEqual(a.room.state, 'over');
  assert.ok(['empty', 'majority', 'limit'].includes(a.room.reason), a.room.reason);
  assert.ok([0, 1, 2].includes(a.room.winner));
  closeAll(a, b);
});

test('resigning ends the game and rematch swaps sides', async () => {
  await ready;
  const [a, b] = await pair();
  const sideA = a.room.you;
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.reason, 'resign');
  assert.strictEqual(b.room.winner, b.room.you);
  send(a, 'rematch'); send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.games === 2));
  assert.notStrictEqual(a.room.you, sideA, 'sides swap on a rematch');
  assert.deepStrictEqual(a.room.board, L.newGame().board);
  closeAll(a, b);
});

test('running out of time loses the game for the one on move', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b);
  assert.ok(await until(() => a.room.state === 'over', 5000), 'the timer fires');
  assert.strictEqual(a.room.reason, 'timeout');
  assert.strictEqual(a.room.winner, 1 - first.room.you);
  closeAll(a, b);
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'playing' && b.room && b.room.state === 'playing'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('a dropped player can resume the same seat with the token', async () => {
  await ready;
  const [a, b] = await pair();
  const token = a.room.token, code = a.room.code, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open();
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'playing'));
  assert.ok(await until(() => b.room.players.every((p) => p.online)));
  a2.ws.close(); b.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  c.ws.close();
});

test('shutdown', () => { child.kill(); });
